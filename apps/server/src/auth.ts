import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ApiError } from "@edgetts/shared";

export const MIN_API_KEY_LENGTH = 16;

export const UNAUTHORIZED_ERROR: ApiError = {
  error: {
    code: "UNAUTHORIZED",
    message: "Missing or invalid API key",
  },
};

export function resolveApiKey(configuredKey?: string | null): string | null {
  if (configuredKey === null) {
    return null;
  }

  const rawKey = configuredKey !== undefined ? configuredKey : process.env["API_KEY"];

  if (rawKey === undefined) {
    return null;
  }

  if (typeof rawKey !== "string" || rawKey.length === 0 || rawKey.trim().length === 0) {
    throw new RangeError("API_KEY must not be empty or whitespace only");
  }

  if (/\s/.test(rawKey)) {
    throw new RangeError("API_KEY must contain no whitespace");
  }

  if (rawKey.length < MIN_API_KEY_LENGTH) {
    throw new RangeError(
      `API_KEY must be at least ${MIN_API_KEY_LENGTH} characters long (got ${rawKey.length})`,
    );
  }

  return rawKey;
}

export function resolveRequireApiKey(configured?: boolean | string | null): boolean {
  if (typeof configured === "boolean") {
    return configured;
  }

  const raw =
    configured !== undefined && configured !== null ? configured : process.env["REQUIRE_API_KEY"];

  if (raw === undefined || raw === null) {
    return process.env["NODE_ENV"] === "production";
  }

  if (typeof raw !== "string") {
    throw new TypeError("REQUIRE_API_KEY must be either 'true' or 'false'");
  }

  if (raw === "true") {
    return true;
  }

  if (raw === "false") {
    return false;
  }

  throw new RangeError("REQUIRE_API_KEY must be either 'true' or 'false'");
}

export function resolveAuthConfiguration(options?: {
  readonly apiKey?: string | null | undefined;
  readonly requireApiKey?: boolean | string | undefined;
}): string | null {
  const requireApiKey = resolveRequireApiKey(options?.requireApiKey);

  let apiKey: string | null = null;
  try {
    apiKey = resolveApiKey(options?.apiKey);
  } catch (err) {
    if (requireApiKey) {
      throw new RangeError("API_KEY is required when REQUIRE_API_KEY=true", { cause: err });
    }
    throw err;
  }

  if (requireApiKey && !apiKey) {
    throw new RangeError("API_KEY is required when REQUIRE_API_KEY=true");
  }

  return apiKey;
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
  if (!match || !match[1]) {
    return null;
  }
  return match[1];
}

export function createApiKeyVerifier(
  configuredKey: string,
): (candidate: string | undefined) => boolean {
  const configuredHash = crypto.createHash("sha256").update(configuredKey).digest();

  return function verifyApiKey(candidate: string | undefined): boolean {
    if (!candidate) {
      return false;
    }
    const candidateHash = crypto.createHash("sha256").update(candidate).digest();
    return crypto.timingSafeEqual(configuredHash, candidateHash);
  };
}

export function createAuthPreHandler(
  configuredKey: string,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const verify = createApiKeyVerifier(configuredKey);

  return async function authPreHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const authHeader = request.headers.authorization;
    const token = extractBearerToken(authHeader);

    if (!token || !verify(token)) {
      return reply
        .code(401)
        .header("WWW-Authenticate", 'Bearer realm="edgeTTS"')
        .type("application/json")
        .send(UNAUTHORIZED_ERROR);
    }
  };
}
