import type { FastifyInstance } from "fastify";
import type { ApiError } from "@edgetts/shared";

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

export interface SpeechRateLimitOptions {
  readonly max?: number | string | undefined;
  readonly timeWindowMs?: number | string | undefined;
}

export interface SpeechRateLimitConfig {
  readonly max: number;
  readonly timeWindowMs: number;
}

export function parseStrictInteger(
  value: unknown,
  varName: string,
  min: number,
  max: number,
  defaultValue: number,
): number {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  let str: string;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new RangeError(`${varName} must be an integer (got ${value})`);
    }
    if (value < min || value > max) {
      throw new RangeError(`${varName} must be between ${min} and ${max} (got ${value})`);
    }
    return value;
  } else if (typeof value === "string") {
    str = value;
  } else {
    throw new TypeError(`${varName} must be an integer string or number`);
  }

  if (str.trim().length === 0) {
    throw new RangeError(`${varName} must not be empty or whitespace only`);
  }

  if (!/^\d+$/.test(str) || str !== str.trim()) {
    throw new RangeError(`${varName} must be an integer`);
  }

  const num = Number(str);
  if (!Number.isSafeInteger(num)) {
    throw new RangeError(`${varName} must be a safe integer`);
  }

  if (num < min || num > max) {
    throw new RangeError(`${varName} must be between ${min} and ${max} (got ${num})`);
  }

  return num;
}

export function resolveSpeechRateLimitConfig(
  options?: SpeechRateLimitOptions,
): SpeechRateLimitConfig {
  const max = parseStrictInteger(
    options?.max ?? process.env["SPEECH_RATE_LIMIT_MAX"],
    "SPEECH_RATE_LIMIT_MAX",
    MIN_SPEECH_RATE_LIMIT_MAX,
    MAX_SPEECH_RATE_LIMIT_MAX,
    DEFAULT_SPEECH_RATE_LIMIT_MAX,
  );

  const timeWindowMs = parseStrictInteger(
    options?.timeWindowMs ?? process.env["SPEECH_RATE_LIMIT_WINDOW_MS"],
    "SPEECH_RATE_LIMIT_WINDOW_MS",
    MIN_SPEECH_RATE_LIMIT_WINDOW_MS,
    MAX_SPEECH_RATE_LIMIT_WINDOW_MS,
    DEFAULT_SPEECH_RATE_LIMIT_WINDOW_MS,
  );

  return { max, timeWindowMs };
}

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
    keyGenerator: () => "speech-global",
    groupId: "speech-admission",
    errorResponseBuilder: (_req, context) => {
      return new RateLimitedError(RATE_LIMITED_ERROR.error.message, context.statusCode);
    },
  });
}
