import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TtsVoice } from "@edgetts/tts-core";
import { createApp } from "../src/app.js";
import type { AppDependencies, TtsServicePort } from "../src/dependencies.js";
import {
  DEFAULT_SPEECH_RATE_LIMIT_MAX,
  DEFAULT_SPEECH_RATE_LIMIT_WINDOW_MS,
  MAX_SPEECH_RATE_LIMIT_MAX,
  MAX_SPEECH_RATE_LIMIT_WINDOW_MS,
  MIN_SPEECH_RATE_LIMIT_MAX,
  MIN_SPEECH_RATE_LIMIT_WINDOW_MS,
  parseStrictInteger,
  RATE_LIMITED_ERROR,
  resolveSpeechRateLimitConfig,
} from "../src/rate-limit.js";

const VALID_TEST_KEY = "test-api-key-1234567890-abcdef";

function createMockTtsService(): TtsServicePort {
  const dummyVoice: TtsVoice = {
    id: "zh-CN-XiaoxiaoNeural",
    displayName: "Xiaoxiao",
    locale: "zh-CN",
    gender: "Female",
  };

  async function* dummyAudio() {
    yield new Uint8Array([1, 2, 3]);
  }

  return {
    listVoices: vi.fn(async () => [dummyVoice]),
    synthesize: vi.fn(async () => ({
      format: "mp3-48k" as const,
      contentType: "audio/mpeg" as const,
      audio: dummyAudio(),
    })),
    synthesizeSegmented: vi.fn(async () => ({
      format: "mp3-48k" as const,
      contentType: "audio/mpeg" as const,
      audio: dummyAudio(),
    })),
  };
}

describe("parseStrictInteger", () => {
  it("returns default value when input is null or undefined", () => {
    expect(parseStrictInteger(undefined, "TEST_VAR", 1, 100, 42)).toBe(42);
    expect(parseStrictInteger(null, "TEST_VAR", 1, 100, 42)).toBe(42);
  });

  it("returns number when input is a valid integer number", () => {
    expect(parseStrictInteger(10, "TEST_VAR", 1, 100, 42)).toBe(10);
    expect(parseStrictInteger(1, "TEST_VAR", 1, 100, 42)).toBe(1);
    expect(parseStrictInteger(100, "TEST_VAR", 1, 100, 42)).toBe(100);
  });

  it("throws RangeError when number is not an integer", () => {
    expect(() => parseStrictInteger(10.5, "TEST_VAR", 1, 100, 42)).toThrow(RangeError);
  });

  it("throws RangeError when number is out of bounds", () => {
    expect(() => parseStrictInteger(0, "TEST_VAR", 1, 100, 42)).toThrow(RangeError);
    expect(() => parseStrictInteger(101, "TEST_VAR", 1, 100, 42)).toThrow(RangeError);
  });

  it("throws TypeError when input is not string or number", () => {
    expect(() => parseStrictInteger({}, "TEST_VAR", 1, 100, 42)).toThrow(TypeError);
    expect(() => parseStrictInteger([], "TEST_VAR", 1, 100, 42)).toThrow(TypeError);
    expect(() => parseStrictInteger(true, "TEST_VAR", 1, 100, 42)).toThrow(TypeError);
  });

  it("returns parsed integer when input is a valid string", () => {
    expect(parseStrictInteger("50", "TEST_VAR", 1, 100, 42)).toBe(50);
    expect(parseStrictInteger("1", "TEST_VAR", 1, 100, 42)).toBe(1);
    expect(parseStrictInteger("100", "TEST_VAR", 1, 100, 42)).toBe(100);
  });

  it("throws RangeError when string is empty or whitespace only", () => {
    expect(() => parseStrictInteger("", "TEST_VAR", 1, 100, 42)).toThrow(RangeError);
    expect(() => parseStrictInteger("   ", "TEST_VAR", 1, 100, 42)).toThrow(RangeError);
  });

  it("throws RangeError when string has leading or trailing whitespace", () => {
    expect(() => parseStrictInteger(" 50", "TEST_VAR", 1, 100, 42)).toThrow(RangeError);
    expect(() => parseStrictInteger("50 ", "TEST_VAR", 1, 100, 42)).toThrow(RangeError);
  });

  it("throws RangeError when string contains non-digit characters", () => {
    expect(() => parseStrictInteger("50a", "TEST_VAR", 1, 100, 42)).toThrow(RangeError);
    expect(() => parseStrictInteger("+50", "TEST_VAR", 1, 100, 42)).toThrow(RangeError);
    expect(() => parseStrictInteger("-50", "TEST_VAR", 1, 100, 42)).toThrow(RangeError);
    expect(() => parseStrictInteger("50.5", "TEST_VAR", 1, 100, 42)).toThrow(RangeError);
  });

  it("throws RangeError when parsed string is out of bounds", () => {
    expect(() => parseStrictInteger("0", "TEST_VAR", 1, 100, 42)).toThrow(RangeError);
    expect(() => parseStrictInteger("101", "TEST_VAR", 1, 100, 42)).toThrow(RangeError);
  });
});

describe("resolveSpeechRateLimitConfig", () => {
  const origMax = process.env["SPEECH_RATE_LIMIT_MAX"];
  const origWin = process.env["SPEECH_RATE_LIMIT_WINDOW_MS"];

  beforeEach(() => {
    delete process.env["SPEECH_RATE_LIMIT_MAX"];
    delete process.env["SPEECH_RATE_LIMIT_WINDOW_MS"];
  });

  afterEach(() => {
    if (origMax !== undefined) process.env["SPEECH_RATE_LIMIT_MAX"] = origMax;
    else delete process.env["SPEECH_RATE_LIMIT_MAX"];
    if (origWin !== undefined) process.env["SPEECH_RATE_LIMIT_WINDOW_MS"] = origWin;
    else delete process.env["SPEECH_RATE_LIMIT_WINDOW_MS"];
  });

  it("resolves default values when options and environment are unset", () => {
    const config = resolveSpeechRateLimitConfig();
    expect(config.max).toBe(DEFAULT_SPEECH_RATE_LIMIT_MAX);
    expect(config.timeWindowMs).toBe(DEFAULT_SPEECH_RATE_LIMIT_WINDOW_MS);
  });

  it("resolves values from options", () => {
    const config = resolveSpeechRateLimitConfig({ max: 20, timeWindowMs: 5000 });
    expect(config.max).toBe(20);
    expect(config.timeWindowMs).toBe(5000);
  });

  it("resolves values from environment variables", () => {
    process.env["SPEECH_RATE_LIMIT_MAX"] = "50";
    process.env["SPEECH_RATE_LIMIT_WINDOW_MS"] = "30000";
    const config = resolveSpeechRateLimitConfig();
    expect(config.max).toBe(50);
    expect(config.timeWindowMs).toBe(30000);
  });

  it("options take precedence over environment variables", () => {
    process.env["SPEECH_RATE_LIMIT_MAX"] = "50";
    process.env["SPEECH_RATE_LIMIT_WINDOW_MS"] = "30000";
    const config = resolveSpeechRateLimitConfig({ max: 10, timeWindowMs: 15000 });
    expect(config.max).toBe(10);
    expect(config.timeWindowMs).toBe(15000);
  });

  it("throws RangeError if max exceeds bounds", () => {
    expect(() => resolveSpeechRateLimitConfig({ max: MIN_SPEECH_RATE_LIMIT_MAX - 1 })).toThrow(
      RangeError,
    );
    expect(() => resolveSpeechRateLimitConfig({ max: MAX_SPEECH_RATE_LIMIT_MAX + 1 })).toThrow(
      RangeError,
    );
  });

  it("throws RangeError if timeWindowMs exceeds bounds", () => {
    expect(() =>
      resolveSpeechRateLimitConfig({ timeWindowMs: MIN_SPEECH_RATE_LIMIT_WINDOW_MS - 1 }),
    ).toThrow(RangeError);
    expect(() =>
      resolveSpeechRateLimitConfig({ timeWindowMs: MAX_SPEECH_RATE_LIMIT_WINDOW_MS + 1 }),
    ).toThrow(RangeError);
  });
});

describe("Speech Rate Limit Integration", () => {
  let mockTtsService: TtsServicePort;
  let dependencies: AppDependencies;

  beforeEach(() => {
    mockTtsService = createMockTtsService();
    dependencies = { ttsService: mockTtsService };
  });

  it("does not rate limit /api/voices, /health, or /api/health", async () => {
    const app = createApp(dependencies, {
      speechRateLimit: { max: 1, timeWindowMs: 60000 },
      serveStatic: false,
    });

    // Request voices 10 times - should all succeed (200)
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({ method: "GET", url: "/api/voices" });
      expect(res.statusCode).toBe(200);
    }
    expect(mockTtsService.listVoices).toHaveBeenCalledTimes(10);

    // Request health 10 times - should all succeed (200)
    for (let i = 0; i < 10; i++) {
      const resHealth = await app.inject({ method: "GET", url: "/health" });
      expect(resHealth.statusCode).toBe(200);
      const resApiHealth = await app.inject({ method: "GET", url: "/api/health" });
      expect(resApiHealth.statusCode).toBe(200);
    }
  });

  it("shares rate limit budget between /api/speech and /v1/audio/speech", async () => {
    const app = createApp(dependencies, {
      speechRateLimit: { max: 2, timeWindowMs: 60000 },
      serveStatic: false,
    });

    // 1st request to /api/speech -> allowed (200)
    const res1 = await app.inject({
      method: "POST",
      url: "/api/speech",
      payload: { input: "First request", voice: "zh-CN-XiaoxiaoNeural" },
    });
    expect(res1.statusCode).toBe(200);

    // 2nd request to /v1/audio/speech -> allowed (200)
    const res2 = await app.inject({
      method: "POST",
      url: "/v1/audio/speech",
      payload: { model: "tts-1", input: "Second request", voice: "zh-CN-XiaoxiaoNeural" },
    });
    expect(res2.statusCode).toBe(200);

    // 3rd request to /api/speech -> rate limited (429)
    const res3 = await app.inject({
      method: "POST",
      url: "/api/speech",
      payload: { input: "Third request", voice: "zh-CN-XiaoxiaoNeural" },
    });
    expect(res3.statusCode).toBe(429);
    expect(res3.headers["content-type"]).toContain("application/json");
    expect(res3.headers["retry-after"]).toBeDefined();
    expect(res3.json()).toEqual(RATE_LIMITED_ERROR);

    // 4th request to /v1/audio/speech -> rate limited (429)
    const res4 = await app.inject({
      method: "POST",
      url: "/v1/audio/speech",
      payload: { model: "tts-1", input: "Fourth request", voice: "zh-CN-XiaoxiaoNeural" },
    });
    expect(res4.statusCode).toBe(429);
    expect(res4.headers["content-type"]).toContain("application/json");
    expect(res4.headers["retry-after"]).toBeDefined();
    expect(res4.json()).toEqual(RATE_LIMITED_ERROR);
  });

  it("never invokes TTS service for 429 rate-limited requests", async () => {
    const app = createApp(dependencies, {
      speechRateLimit: { max: 1, timeWindowMs: 60000 },
      serveStatic: false,
    });

    const res1 = await app.inject({
      method: "POST",
      url: "/api/speech",
      payload: { input: "Request 1", voice: "zh-CN-XiaoxiaoNeural" },
    });
    expect(res1.statusCode).toBe(200);
    expect(mockTtsService.synthesizeSegmented).toHaveBeenCalledTimes(1);

    // Subsequent requests hit 429 and must not call synthesizeSegmented or synthesize
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/speech",
        payload: { input: `Request ${i + 2}`, voice: "zh-CN-XiaoxiaoNeural" },
      });
      expect(res.statusCode).toBe(429);
    }
    expect(mockTtsService.synthesizeSegmented).toHaveBeenCalledTimes(1);
    expect(mockTtsService.synthesize).not.toHaveBeenCalled();
  });

  it("runs authentication before rate limiting (401 does not consume rate limit quota)", async () => {
    const app = createApp(dependencies, {
      apiKey: VALID_TEST_KEY,
      speechRateLimit: { max: 1, timeWindowMs: 60000 },
      serveStatic: false,
    });

    // 5 unauthenticated requests -> 401 Unauthorized
    for (let i = 0; i < 5; i++) {
      const resUnauth = await app.inject({
        method: "POST",
        url: "/api/speech",
        payload: { input: "Unauthorized request", voice: "zh-CN-XiaoxiaoNeural" },
      });
      expect(resUnauth.statusCode).toBe(401);
    }

    // Authenticated request should still have full quota available (max: 1)
    const resAuth1 = await app.inject({
      method: "POST",
      url: "/api/speech",
      headers: { authorization: `Bearer ${VALID_TEST_KEY}` },
      payload: { input: "Authorized request 1", voice: "zh-CN-XiaoxiaoNeural" },
    });
    expect(resAuth1.statusCode).toBe(200);

    // Second authenticated request hits the quota
    const resAuth2 = await app.inject({
      method: "POST",
      url: "/api/speech",
      headers: { authorization: `Bearer ${VALID_TEST_KEY}` },
      payload: { input: "Authorized request 2", voice: "zh-CN-XiaoxiaoNeural" },
    });
    expect(resAuth2.statusCode).toBe(429);
    expect(resAuth2.json()).toEqual(RATE_LIMITED_ERROR);
  });

  it("enforces a global single bucket across different client IPs", async () => {
    const app = createApp(dependencies, {
      speechRateLimit: { max: 1, timeWindowMs: 60000 },
      serveStatic: false,
    });

    // Client A uses quota
    const resA = await app.inject({
      method: "POST",
      url: "/api/speech",
      headers: { "x-forwarded-for": "198.51.100.1" },
      payload: { input: "From IP A", voice: "zh-CN-XiaoxiaoNeural" },
    });
    expect(resA.statusCode).toBe(200);

    // Client B from different IP must still be blocked (single global bucket per server process)
    const resB = await app.inject({
      method: "POST",
      url: "/api/speech",
      headers: { "x-forwarded-for": "203.0.113.99" },
      payload: { input: "From IP B", voice: "zh-CN-XiaoxiaoNeural" },
    });
    expect(resB.statusCode).toBe(429);
    expect(resB.json()).toEqual(RATE_LIMITED_ERROR);
  });
});
