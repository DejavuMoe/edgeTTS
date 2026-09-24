import type { TtsServiceOptions } from "@edgetts/tts-service";
import type { AppOptions } from "./app.js";
import { resolveAuthConfiguration, resolveRequireApiKey } from "./auth.js";
import {
  type Environment,
  parseBooleanFlag,
  parseOptionalInteger,
  parseStrictInteger,
  parseTrustProxy,
  type TrustProxySetting,
} from "./env.js";
import { resolveSpeechRateLimitConfig, type SpeechRateLimitConfig } from "./rate-limit.js";
import { resolveWebDistDir, shouldEnableStaticHosting } from "./static.js";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8080;

/** Provider timeout overrides; structurally matches EdgeTtsProviderOptions. */
export interface ProviderTuning {
  readonly listVoicesTimeoutMs?: number;
  readonly setupTimeoutMs?: number;
  readonly audioIdleTimeoutMs?: number;
}

export type ServiceTuning = Pick<
  TtsServiceOptions,
  "maxConcurrentSyntheses" | "maxQueuedSyntheses" | "voiceCacheTtlMs"
>;

/** Only explicitly configured values are present; each layer keeps its own defaults. */
export interface TtsTuning {
  readonly service: ServiceTuning;
  readonly provider: ProviderTuning;
}

export interface ResolvedAppOptions extends AppOptions {
  readonly apiKey: string | null;
  readonly requireApiKey: boolean;
  readonly speechRateLimit: SpeechRateLimitConfig;
  readonly serveStatic: boolean;
  readonly webDistDir: string;
  readonly trustProxy: TrustProxySetting;
  readonly logger: boolean;
}

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly app: ResolvedAppOptions;
  readonly tts: TtsTuning;
}

export class ConfigurationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "ConfigurationError";
    this.issues = issues;
  }
}

/**
 * Resolves the complete server configuration from `env` in one pass.
 *
 * This is the only production code path that reads environment variables. Every invalid
 * variable is reported together in a {@link ConfigurationError}; messages never echo secrets.
 */
export function loadServerConfig(env: Environment = process.env): ServerConfig {
  const issues = new Set<string>();
  // Returns a placeholder on failure; the collected issues are thrown before any use.
  const attempt = <T>(resolve: () => T): T => {
    try {
      return resolve();
    } catch (error) {
      issues.add(error instanceof Error ? error.message : String(error));
      return undefined as T;
    }
  };
  const optionalInteger = (name: string, min: number, max: number) =>
    attempt(() => parseOptionalInteger(env[name], name, min, max));

  const config: ServerConfig = {
    host: attempt(() => parseHost(env["HOST"])),
    port: attempt(() => parseStrictInteger(env["PORT"], "PORT", 1, 65_535, DEFAULT_PORT)),
    app: {
      apiKey: attempt(() => resolveAuthConfiguration(undefined, env)),
      requireApiKey: attempt(() => resolveRequireApiKey(undefined, env)),
      speechRateLimit: attempt(() => resolveSpeechRateLimitConfig(undefined, env)),
      serveStatic: attempt(() => resolveServeStatic(env)),
      webDistDir: resolveWebDistDir(undefined, env),
      trustProxy: attempt(() => parseTrustProxy(env["TRUST_PROXY"])),
      logger: env["NODE_ENV"] !== "test",
    },
    tts: {
      service: definedOnly({
        maxConcurrentSyntheses: optionalInteger("SYNTHESIS_MAX_CONCURRENT", 1, 64),
        maxQueuedSyntheses: optionalInteger("SYNTHESIS_MAX_QUEUED", 0, 1024),
        voiceCacheTtlMs: optionalInteger("VOICE_CACHE_TTL_MS", 60_000, 604_800_000),
      }),
      provider: definedOnly({
        listVoicesTimeoutMs: optionalInteger("EDGE_VOICES_TIMEOUT_MS", 1_000, 600_000),
        setupTimeoutMs: optionalInteger("EDGE_SETUP_TIMEOUT_MS", 1_000, 600_000),
        audioIdleTimeoutMs: optionalInteger("EDGE_AUDIO_IDLE_TIMEOUT_MS", 1_000, 600_000),
      }),
    },
  };

  if (issues.size > 0) {
    throw new ConfigurationError([...issues]);
  }
  return config;
}

function parseHost(value: string | undefined): string {
  if (value === undefined) return DEFAULT_HOST;
  if (value.length === 0 || /\s/.test(value)) {
    throw new RangeError("HOST must be a non-empty address without whitespace");
  }
  return value;
}

function resolveServeStatic(env: Environment): boolean {
  const value = env["SERVE_STATIC"];
  // Validate explicitly: an unrecognized value must not silently fall back to NODE_ENV.
  if (value !== undefined) parseBooleanFlag(value, "SERVE_STATIC");
  return shouldEnableStaticHosting(undefined, env);
}

function definedOnly<T extends Record<string, unknown>>(
  values: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}
