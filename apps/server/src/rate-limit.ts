import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ApiError } from "@edgetts/shared";
import { type Environment, parseStrictInteger } from "./env.js";

export { parseStrictInteger };

export const DEFAULT_SPEECH_RATE_LIMIT_MAX = 12;
export const DEFAULT_SPEECH_RATE_LIMIT_WINDOW_MS = 10000;
export const MIN_SPEECH_RATE_LIMIT_MAX = 1;
export const MAX_SPEECH_RATE_LIMIT_MAX = 10000;
export const MIN_SPEECH_RATE_LIMIT_WINDOW_MS = 100;
export const MAX_SPEECH_RATE_LIMIT_WINDOW_MS = 3600000;

export const RATE_LIMITED_ERROR: ApiError = {
  error: {
    code: "RATE_LIMITED",
    message: "Too many speech requests",
  },
};

/** Who shares a speech budget: every caller, or each client address. Both routes always share. */
export type SpeechRateLimitScope = "global" | "ip";

export const DEFAULT_SPEECH_RATE_LIMIT_SCOPE: SpeechRateLimitScope = "global";

export interface SpeechRateLimitOptions {
  readonly max?: number | string | undefined;
  readonly timeWindowMs?: number | string | undefined;
  readonly scope?: SpeechRateLimitScope | undefined;
}

export interface SpeechRateLimitConfig {
  readonly max: number;
  readonly timeWindowMs: number;
  readonly scope: SpeechRateLimitScope;
}

export function resolveSpeechRateLimitConfig(
  options?: SpeechRateLimitOptions,
  env: Environment = process.env,
): SpeechRateLimitConfig {
  const max = parseStrictInteger(
    options?.max ?? env["SPEECH_RATE_LIMIT_MAX"],
    "SPEECH_RATE_LIMIT_MAX",
    MIN_SPEECH_RATE_LIMIT_MAX,
    MAX_SPEECH_RATE_LIMIT_MAX,
    DEFAULT_SPEECH_RATE_LIMIT_MAX,
  );

  const timeWindowMs = parseStrictInteger(
    options?.timeWindowMs ?? env["SPEECH_RATE_LIMIT_WINDOW_MS"],
    "SPEECH_RATE_LIMIT_WINDOW_MS",
    MIN_SPEECH_RATE_LIMIT_WINDOW_MS,
    MAX_SPEECH_RATE_LIMIT_WINDOW_MS,
    DEFAULT_SPEECH_RATE_LIMIT_WINDOW_MS,
  );

  const scope = parseSpeechRateLimitScope(options?.scope ?? env["SPEECH_RATE_LIMIT_SCOPE"]);

  return { max, timeWindowMs, scope };
}

function parseSpeechRateLimitScope(value: string | undefined): SpeechRateLimitScope {
  if (value === undefined) return DEFAULT_SPEECH_RATE_LIMIT_SCOPE;
  if (value === "global" || value === "ip") return value;
  throw new RangeError("SPEECH_RATE_LIMIT_SCOPE must be either 'global' or 'ip'");
}

const SPEECH_RATE_LIMIT_KEYS: Record<SpeechRateLimitScope, (request: FastifyRequest) => string> = {
  global: () => "speech-global",
  // request.ip honors TRUST_PROXY, so forwarded addresses count only from trusted proxies.
  ip: (request) => `speech-ip:${request.ip}`,
};

export class RateLimitedError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode = 429) {
    super(message);
    this.name = "RateLimitedError";
    this.statusCode = statusCode;
  }
}

export function createSpeechRateLimiter(scope: FastifyInstance, config: SpeechRateLimitConfig) {
  return scope.rateLimit({
    max: config.max,
    timeWindow: config.timeWindowMs,
    keyGenerator: SPEECH_RATE_LIMIT_KEYS[config.scope],
    errorResponseBuilder: (_req, context) => {
      return new RateLimitedError(RATE_LIMITED_ERROR.error.message, context.statusCode);
    },
  });
}
