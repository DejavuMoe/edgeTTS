import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TtsVoice } from "@edgetts/tts-core";
import { createApp } from "../src/app.js";
import {
  createApiKeyVerifier,
  extractBearerToken,
  resolveApiKey,
  resolveAuthConfiguration,
  resolveRequireApiKey,
  UNAUTHORIZED_ERROR,
} from "../src/auth.js";
import type { AppDependencies, TtsServicePort } from "../src/dependencies.js";

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
      segmentCount: 1,
      audio: dummyAudio(),
    })),
  };
}

describe("API Key Resolution & Validation", () => {
  const originalEnv = process.env["API_KEY"];

  beforeEach(() => {
    delete process.env["API_KEY"];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env["API_KEY"] = originalEnv;
    } else {
      delete process.env["API_KEY"];
    }
  });

  it("resolves to null when API_KEY is unset and no explicit option is passed", () => {
    expect(resolveApiKey()).toBeNull();
  });

  it("resolves to null when apiKey is explicitly null regardless of env", () => {
    process.env["API_KEY"] = VALID_TEST_KEY;
    expect(resolveApiKey(null)).toBeNull();
  });

  it("resolves to valid key from environment variable when omitted in options", () => {
    process.env["API_KEY"] = VALID_TEST_KEY;
    expect(resolveApiKey()).toBe(VALID_TEST_KEY);
  });

  it("explicit option overrides environment variable", () => {
    process.env["API_KEY"] = "env-key-1234567890-env";
    const explicitKey = "explicit-key-1234567890-opt";
    expect(resolveApiKey(explicitKey)).toBe(explicitKey);
  });

  it("throws RangeError if API_KEY is empty string", () => {
    expect(() => resolveApiKey("")).toThrow(RangeError);
    process.env["API_KEY"] = "";
    expect(() => resolveApiKey()).toThrow(RangeError);
  });

  it("throws RangeError if API_KEY is whitespace only", () => {
    expect(() => resolveApiKey("   ")).toThrow(RangeError);
  });

  it("throws RangeError if API_KEY contains whitespace characters", () => {
    expect(() => resolveApiKey("secret with spaces 12345")).toThrow(RangeError);
    expect(() => resolveApiKey("secret\twith\ttab123456")).toThrow(RangeError);
  });

  it("throws RangeError if API_KEY is below 16 characters", () => {
    expect(() => resolveApiKey("short-key-12345")).toThrow(RangeError);
  });
});

describe("REQUIRE_API_KEY Resolution & Validation", () => {
  const originalEnv = process.env["REQUIRE_API_KEY"];

  beforeEach(() => {
    delete process.env["REQUIRE_API_KEY"];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env["REQUIRE_API_KEY"] = originalEnv;
    } else {
      delete process.env["REQUIRE_API_KEY"];
    }
  });

  it("defaults to false when unset and no explicit option passed", () => {
    expect(resolveRequireApiKey()).toBe(false);
  });

  it("resolves boolean literals directly", () => {
    expect(resolveRequireApiKey(true)).toBe(true);
    expect(resolveRequireApiKey(false)).toBe(false);
  });

  it("resolves strict string 'true' and 'false'", () => {
    expect(resolveRequireApiKey("true")).toBe(true);
    expect(resolveRequireApiKey("false")).toBe(false);
    process.env["REQUIRE_API_KEY"] = "true";
    expect(resolveRequireApiKey()).toBe(true);
    process.env["REQUIRE_API_KEY"] = "false";
    expect(resolveRequireApiKey()).toBe(false);
  });

  it("throws RangeError on non-strict string values", () => {
    for (const val of [
      "1",
      "0",
      "yes",
      "no",
      "TRUE",
      "FALSE",
      "True",
      "False",
      "",
      " true ",
      "false ",
    ]) {
      expect(() => resolveRequireApiKey(val)).toThrow(RangeError);
      process.env["REQUIRE_API_KEY"] = val;
      expect(() => resolveRequireApiKey()).toThrow(RangeError);
    }
  });

  it("throws TypeError on non-string non-boolean types", () => {
    // @ts-expect-error testing invalid type
    expect(() => resolveRequireApiKey(123)).toThrow(TypeError);
    // @ts-expect-error testing invalid type
    expect(() => resolveRequireApiKey({})).toThrow(TypeError);
  });
});

describe("resolveAuthConfiguration", () => {
  const originalKey = process.env["API_KEY"];
  const originalRequire = process.env["REQUIRE_API_KEY"];

  beforeEach(() => {
    delete process.env["API_KEY"];
    delete process.env["REQUIRE_API_KEY"];
  });

  afterEach(() => {
    if (originalKey !== undefined) process.env["API_KEY"] = originalKey;
    else delete process.env["API_KEY"];
    if (originalRequire !== undefined) process.env["REQUIRE_API_KEY"] = originalRequire;
    else delete process.env["REQUIRE_API_KEY"];
  });

  it("returns null when requireApiKey=false and apiKey is not set", () => {
    expect(resolveAuthConfiguration({ requireApiKey: false })).toBeNull();
    expect(resolveAuthConfiguration()).toBeNull();
  });

  it("returns key when requireApiKey=false and valid apiKey is provided", () => {
    expect(resolveAuthConfiguration({ requireApiKey: false, apiKey: VALID_TEST_KEY })).toBe(
      VALID_TEST_KEY,
    );
    process.env["API_KEY"] = VALID_TEST_KEY;
    expect(resolveAuthConfiguration({ requireApiKey: false })).toBe(VALID_TEST_KEY);
  });

  it("throws RangeError when requireApiKey=false but provided apiKey is invalid", () => {
    expect(() => resolveAuthConfiguration({ requireApiKey: false, apiKey: "short" })).toThrow(
      RangeError,
    );
  });

  it("throws RangeError when requireApiKey=true and apiKey is unset", () => {
    expect(() => resolveAuthConfiguration({ requireApiKey: true })).toThrow(
      "API_KEY is required when REQUIRE_API_KEY=true",
    );
    process.env["REQUIRE_API_KEY"] = "true";
    expect(() => resolveAuthConfiguration()).toThrow(
      "API_KEY is required when REQUIRE_API_KEY=true",
    );
  });

  it("throws RangeError when requireApiKey=true and apiKey is invalid/empty/whitespace", () => {
    expect(() => resolveAuthConfiguration({ requireApiKey: true, apiKey: "" })).toThrow(
      "API_KEY is required when REQUIRE_API_KEY=true",
    );
    expect(() => resolveAuthConfiguration({ requireApiKey: true, apiKey: "short" })).toThrow(
      "API_KEY is required when REQUIRE_API_KEY=true",
    );
    expect(() =>
      resolveAuthConfiguration({ requireApiKey: true, apiKey: "spaces in key 123456" }),
    ).toThrow("API_KEY is required when REQUIRE_API_KEY=true");
  });

  it("returns validated key when requireApiKey=true and valid key is provided", () => {
    expect(resolveAuthConfiguration({ requireApiKey: true, apiKey: VALID_TEST_KEY })).toBe(
      VALID_TEST_KEY,
    );
    process.env["REQUIRE_API_KEY"] = "true";
    process.env["API_KEY"] = VALID_TEST_KEY;
    expect(resolveAuthConfiguration()).toBe(VALID_TEST_KEY);
  });
});

describe("extractBearerToken", () => {
  it("extracts token from standard Bearer header", () => {
    expect(extractBearerToken("Bearer my-secret-token-123")).toBe("my-secret-token-123");
  });

  it("extracts token with case-insensitive scheme (bearer, BEARER)", () => {
    expect(extractBearerToken("bearer my-secret-token-123")).toBe("my-secret-token-123");
    expect(extractBearerToken("BEARER my-secret-token-123")).toBe("my-secret-token-123");
  });

  it("handles leading and trailing whitespace around header", () => {
    expect(extractBearerToken("  Bearer my-secret-token-123  ")).toBe("my-secret-token-123");
  });

  it("returns null for non-Bearer schemes (e.g. Basic)", () => {
    expect(extractBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
  });

  it("returns null for missing or empty header", () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken("")).toBeNull();
    expect(extractBearerToken("   ")).toBeNull();
  });

  it("returns null for Bearer with no token", () => {
    expect(extractBearerToken("Bearer")).toBeNull();
    expect(extractBearerToken("Bearer   ")).toBeNull();
  });

  it("returns null for Bearer with multiple tokens / garbage", () => {
    expect(extractBearerToken("Bearer token extra")).toBeNull();
  });
});

describe("Constant-Time Verifier", () => {
  const verifier = createApiKeyVerifier(VALID_TEST_KEY);

  it("returns true for exact matching candidate", () => {
    expect(verifier(VALID_TEST_KEY)).toBe(true);
  });

  it("returns false for incorrect candidate of same length", () => {
    const wrong = VALID_TEST_KEY.slice(0, -1) + "x";
    expect(verifier(wrong)).toBe(false);
  });

  it("returns false for candidate of different length", () => {
    expect(verifier("short")).toBe(false);
    expect(verifier(VALID_TEST_KEY + "-extra")).toBe(false);
  });

  it("returns false for undefined or empty candidate", () => {
    expect(verifier(undefined)).toBe(false);
    expect(verifier("")).toBe(false);
  });

  it("returns false for case mismatch (tokens are case-sensitive)", () => {
    expect(verifier(VALID_TEST_KEY.toUpperCase())).toBe(false);
  });

  it("safely handles Unicode and malformed characters without throwing", () => {
    expect(verifier("🎉🎈🎁🔑🔒🗝️🔥⚡🌟1234567890")).toBe(false);
    expect(verifier("\u0000\u0001\u0002\u00031234567890")).toBe(false);
  });
});

describe("Server Authentication Endpoints Integration", () => {
  let mockTtsService: TtsServicePort;
  let dependencies: AppDependencies;

  beforeEach(() => {
    mockTtsService = createMockTtsService();
    dependencies = { ttsService: mockTtsService };
  });

  describe("When authentication is DISABLED", () => {
    it("allows unauthenticated access to /api/voices, /api/speech, and /v1/audio/speech", async () => {
      const app = createApp(dependencies, { apiKey: null, serveStatic: false });

      const resVoices = await app.inject({ method: "GET", url: "/api/voices" });
      expect(resVoices.statusCode).toBe(200);
      expect(mockTtsService.listVoices).toHaveBeenCalledTimes(1);

      const resSpeech = await app.inject({
        method: "POST",
        url: "/api/speech",
        payload: { input: "测试文本", voice: "zh-CN-XiaoxiaoNeural" },
      });
      expect(resSpeech.statusCode).toBe(200);
      expect(mockTtsService.synthesizeSegmented).toHaveBeenCalledTimes(1);

      const resOpenAi = await app.inject({
        method: "POST",
        url: "/v1/audio/speech",
        payload: { model: "tts-1", input: "Hello world", voice: "zh-CN-XiaoxiaoNeural" },
      });
      expect(resOpenAi.statusCode).toBe(200);
      expect(mockTtsService.synthesize).toHaveBeenCalledTimes(1);
    });
  });

  describe("When authentication is ENABLED", () => {
    it("keeps /health and /api/health public without Authorization header", async () => {
      const app = createApp(dependencies, { apiKey: VALID_TEST_KEY, serveStatic: false });

      const resHealth = await app.inject({ method: "GET", url: "/health" });
      expect(resHealth.statusCode).toBe(200);
      expect(resHealth.json()).toEqual({ status: "ok" });

      const resApiHealth = await app.inject({ method: "GET", url: "/api/health" });
      expect(resApiHealth.statusCode).toBe(200);
      expect(resApiHealth.json()).toEqual({ status: "ok" });

      expect(mockTtsService.listVoices).not.toHaveBeenCalled();
      expect(mockTtsService.synthesize).not.toHaveBeenCalled();
    });

    it("rejects unauthenticated requests to protected endpoints with 401 and WWW-Authenticate", async () => {
      const app = createApp(dependencies, { apiKey: VALID_TEST_KEY, serveStatic: false });

      // /api/voices
      const resVoices = await app.inject({ method: "GET", url: "/api/voices" });
      expect(resVoices.statusCode).toBe(401);
      expect(resVoices.headers["www-authenticate"]).toBe('Bearer realm="edgeTTS"');
      expect(resVoices.json()).toEqual(UNAUTHORIZED_ERROR);
      expect(mockTtsService.listVoices).not.toHaveBeenCalled();

      // /api/speech
      const resSpeech = await app.inject({
        method: "POST",
        url: "/api/speech",
        payload: { input: "测试文本", voice: "zh-CN-XiaoxiaoNeural" },
      });
      expect(resSpeech.statusCode).toBe(401);
      expect(resSpeech.headers["www-authenticate"]).toBe('Bearer realm="edgeTTS"');
      expect(resSpeech.json()).toEqual(UNAUTHORIZED_ERROR);
      expect(mockTtsService.synthesizeSegmented).not.toHaveBeenCalled();

      // /v1/audio/speech
      const resOpenAi = await app.inject({
        method: "POST",
        url: "/v1/audio/speech",
        payload: { model: "tts-1", input: "Hello world", voice: "zh-CN-XiaoxiaoNeural" },
      });
      expect(resOpenAi.statusCode).toBe(401);
      expect(resOpenAi.headers["www-authenticate"]).toBe('Bearer realm="edgeTTS"');
      expect(resOpenAi.json()).toEqual(UNAUTHORIZED_ERROR);
      expect(mockTtsService.synthesize).not.toHaveBeenCalled();
    });

    it("rejects wrong API key with 401 and does not call service", async () => {
      const app = createApp(dependencies, { apiKey: VALID_TEST_KEY, serveStatic: false });

      const res = await app.inject({
        method: "GET",
        url: "/api/voices",
        headers: { authorization: "Bearer wrong-key-1234567890-xyz" },
      });

      expect(res.statusCode).toBe(401);
      expect(res.headers["www-authenticate"]).toBe('Bearer realm="edgeTTS"');
      expect(res.json()).toEqual(UNAUTHORIZED_ERROR);
      expect(mockTtsService.listVoices).not.toHaveBeenCalled();
    });

    it("rejects malformed Authorization headers (Basic, missing token, extra arguments)", async () => {
      const app = createApp(dependencies, { apiKey: VALID_TEST_KEY, serveStatic: false });

      const resBasic = await app.inject({
        method: "GET",
        url: "/api/voices",
        headers: { authorization: `Basic ${VALID_TEST_KEY}` },
      });
      expect(resBasic.statusCode).toBe(401);

      const resEmpty = await app.inject({
        method: "GET",
        url: "/api/voices",
        headers: { authorization: "Bearer" },
      });
      expect(resEmpty.statusCode).toBe(401);

      const resExtra = await app.inject({
        method: "GET",
        url: "/api/voices",
        headers: { authorization: `Bearer ${VALID_TEST_KEY} extra-junk` },
      });
      expect(resExtra.statusCode).toBe(401);
    });

    it("accepts valid API key with standard 'Bearer' scheme", async () => {
      const app = createApp(dependencies, { apiKey: VALID_TEST_KEY, serveStatic: false });

      const resVoices = await app.inject({
        method: "GET",
        url: "/api/voices",
        headers: { authorization: `Bearer ${VALID_TEST_KEY}` },
      });
      expect(resVoices.statusCode).toBe(200);
      expect(mockTtsService.listVoices).toHaveBeenCalledTimes(1);

      const resSpeech = await app.inject({
        method: "POST",
        url: "/api/speech",
        headers: { authorization: `Bearer ${VALID_TEST_KEY}` },
        payload: { input: "测试文本", voice: "zh-CN-XiaoxiaoNeural" },
      });
      expect(resSpeech.statusCode).toBe(200);
      expect(mockTtsService.synthesizeSegmented).toHaveBeenCalledTimes(1);

      const resOpenAi = await app.inject({
        method: "POST",
        url: "/v1/audio/speech",
        headers: { authorization: `Bearer ${VALID_TEST_KEY}` },
        payload: { model: "tts-1", input: "Hello world", voice: "zh-CN-XiaoxiaoNeural" },
      });
      expect(resOpenAi.statusCode).toBe(200);
      expect(mockTtsService.synthesize).toHaveBeenCalledTimes(1);
    });

    it("accepts valid API key with case-insensitive scheme ('bearer', 'BEARER')", async () => {
      const app = createApp(dependencies, { apiKey: VALID_TEST_KEY, serveStatic: false });

      const resLower = await app.inject({
        method: "GET",
        url: "/api/voices",
        headers: { authorization: `bearer ${VALID_TEST_KEY}` },
      });
      expect(resLower.statusCode).toBe(200);

      const resUpper = await app.inject({
        method: "GET",
        url: "/api/voices",
        headers: { authorization: `BEARER ${VALID_TEST_KEY}` },
      });
      expect(resUpper.statusCode).toBe(200);
    });

    it("does not intercept unknown routes with 401, preserving 404 behavior", async () => {
      const app = createApp(dependencies, { apiKey: VALID_TEST_KEY, serveStatic: false });

      const res = await app.inject({
        method: "GET",
        url: "/api/nonexistent-route",
      });
      expect(res.statusCode).toBe(404);
      expect(res.headers["www-authenticate"]).toBeUndefined();
    });
  });

  describe("Fail-Closed Startup Behavior", () => {
    it("refuses to create app when requireApiKey=true and apiKey is missing", () => {
      expect(() =>
        createApp(dependencies, { requireApiKey: true, apiKey: undefined, serveStatic: false }),
      ).toThrow("API_KEY is required when REQUIRE_API_KEY=true");
    });

    it("refuses to create app when requireApiKey=true and apiKey is empty or whitespace", () => {
      expect(() =>
        createApp(dependencies, { requireApiKey: true, apiKey: "", serveStatic: false }),
      ).toThrow("API_KEY is required when REQUIRE_API_KEY=true");
      expect(() =>
        createApp(dependencies, { requireApiKey: true, apiKey: "   ", serveStatic: false }),
      ).toThrow("API_KEY is required when REQUIRE_API_KEY=true");
    });

    it("refuses to create app when requireApiKey=true and apiKey is shorter than 16 chars", () => {
      expect(() =>
        createApp(dependencies, { requireApiKey: true, apiKey: "too-short", serveStatic: false }),
      ).toThrow("API_KEY is required when REQUIRE_API_KEY=true");
    });

    it("starts up successfully and enforces auth when requireApiKey=true and valid key is provided", async () => {
      const app = createApp(dependencies, {
        requireApiKey: true,
        apiKey: VALID_TEST_KEY,
        serveStatic: false,
      });

      const resUnauth = await app.inject({ method: "GET", url: "/api/voices" });
      expect(resUnauth.statusCode).toBe(401);

      const resAuth = await app.inject({
        method: "GET",
        url: "/api/voices",
        headers: { authorization: `Bearer ${VALID_TEST_KEY}` },
      });
      expect(resAuth.statusCode).toBe(200);
    });

    it("allows unauthenticated operation when requireApiKey=false and apiKey is omitted", async () => {
      const app = createApp(dependencies, {
        requireApiKey: false,
        apiKey: undefined,
        serveStatic: false,
      });

      const res = await app.inject({ method: "GET", url: "/api/voices" });
      expect(res.statusCode).toBe(200);
    });
  });
});
