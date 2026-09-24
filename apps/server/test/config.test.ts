import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { countCodePoints, MAX_NATIVE_INPUT_CODE_POINTS } from "@edgetts/shared";
import type { SynthesisRequest } from "@edgetts/tts-core";
import { createApp, MAX_REQUEST_BODY_BYTES } from "../src/app.js";
import { createProductionDependencies } from "../src/composition.js";
import { ConfigurationError, DEFAULT_HOST, DEFAULT_PORT, loadServerConfig } from "../src/config.js";
import type { TtsServicePort } from "../src/dependencies.js";
import { resolveWebDistDir } from "../src/static.js";

const VALID_KEY = "config-test-api-key-1234567890";

function configError(env: Record<string, string>): ConfigurationError {
  try {
    loadServerConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigurationError);
    return error as ConfigurationError;
  }
  throw new Error("expected loadServerConfig to throw");
}

describe("loadServerConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves documented defaults from an empty environment", () => {
    expect(loadServerConfig({})).toEqual({
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      app: {
        apiKey: null,
        requireApiKey: false,
        speechRateLimit: { max: 12, timeWindowMs: 10_000, scope: "global" },
        serveStatic: false,
        webDistDir: resolveWebDistDir(undefined, {}),
        trustProxy: false,
        metrics: false,
        logger: true,
      },
      tts: { service: {}, provider: {} },
    });
  });

  it("reads only the injected environment, never process.env", () => {
    vi.stubEnv("PORT", "not-a-port");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_KEY", "");
    expect(loadServerConfig({ PORT: "9000" }).port).toBe(9000);
  });

  it("applies production defaults and fails closed without an API key", () => {
    const error = configError({ NODE_ENV: "production" });
    expect(error.issues).toEqual(["API_KEY is required when REQUIRE_API_KEY=true"]);
    // The Docker contract greps this exact text from the startup error.
    expect(error.message).toContain("API_KEY is required when REQUIRE_API_KEY=true");

    const config = loadServerConfig({ NODE_ENV: "production", API_KEY: VALID_KEY });
    expect(config.app).toMatchObject({
      apiKey: VALID_KEY,
      requireApiKey: true,
      serveStatic: true,
      logger: true,
    });
  });

  it("maps every supported variable", () => {
    const config = loadServerConfig({
      NODE_ENV: "test",
      HOST: "0.0.0.0",
      PORT: "18080",
      API_KEY: VALID_KEY,
      REQUIRE_API_KEY: "true",
      SPEECH_RATE_LIMIT_MAX: "30",
      SPEECH_RATE_LIMIT_WINDOW_MS: "60000",
      SPEECH_RATE_LIMIT_SCOPE: "ip",
      SERVE_STATIC: "true",
      WEB_DIST_DIR: "/srv/web",
      TRUST_PROXY: "127.0.0.1, 10.0.0.0/8",
      METRICS_ENABLED: "true",
      SYNTHESIS_MAX_CONCURRENT: "8",
      SYNTHESIS_MAX_QUEUED: "0",
      VOICE_CACHE_TTL_MS: "3600000",
      EDGE_VOICES_TIMEOUT_MS: "5000",
      EDGE_SETUP_TIMEOUT_MS: "15000",
      EDGE_AUDIO_IDLE_TIMEOUT_MS: "60000",
    });
    expect(config).toEqual({
      host: "0.0.0.0",
      port: 18080,
      app: {
        apiKey: VALID_KEY,
        requireApiKey: true,
        speechRateLimit: { max: 30, timeWindowMs: 60_000, scope: "ip" },
        serveStatic: true,
        webDistDir: resolveWebDistDir("/srv/web"),
        trustProxy: ["127.0.0.1", "10.0.0.0/8"],
        metrics: true,
        logger: false,
      },
      tts: {
        service: { maxConcurrentSyntheses: 8, maxQueuedSyntheses: 0, voiceCacheTtlMs: 3_600_000 },
        provider: { listVoicesTimeoutMs: 5000, setupTimeoutMs: 15_000, audioIdleTimeoutMs: 60_000 },
      },
    });
  });

  it.each(["", "abc", "0", "65536", "8080.5", " 8080", "-1", "0x1F90"])(
    "rejects PORT=%j",
    (port) => {
      expect(configError({ PORT: port }).issues).toEqual([expect.stringContaining("PORT")]);
    },
  );

  it.each(["", "local host", " 0.0.0.0"])("rejects HOST=%j", (host) => {
    expect(configError({ HOST: host }).issues).toEqual([
      "HOST must be a non-empty address without whitespace",
    ]);
  });

  it("rejects unrecognized SERVE_STATIC values instead of falling back to NODE_ENV", () => {
    expect(configError({ SERVE_STATIC: "yes" }).issues).toEqual([
      "SERVE_STATIC must be either 'true' or 'false'",
    ]);
    expect(
      loadServerConfig({ SERVE_STATIC: "false", NODE_ENV: "production", API_KEY: VALID_KEY }),
    ).toMatchObject({ app: { serveStatic: false } });
  });

  it.each([
    [undefined, false],
    ["false", false],
    ["true", true],
    ["2", 2],
    ["loopback", ["loopback"]],
    ["127.0.0.1,::1", ["127.0.0.1", "::1"]],
  ])("parses TRUST_PROXY=%j", (value, expected) => {
    const env = value === undefined ? {} : { TRUST_PROXY: value };
    expect(loadServerConfig(env).app.trustProxy).toEqual(expected);
  });

  it.each(["", "0", "17", "127.0.0.1,,10.0.0.1", "10.0.0.1 10.0.0.2"])(
    "rejects TRUST_PROXY=%j",
    (value) => {
      expect(configError({ TRUST_PROXY: value }).issues).toEqual([
        expect.stringContaining("TRUST_PROXY"),
      ]);
    },
  );

  it.each([
    ["SYNTHESIS_MAX_CONCURRENT", "0"],
    ["SYNTHESIS_MAX_CONCURRENT", "65"],
    ["SYNTHESIS_MAX_QUEUED", "1025"],
    ["VOICE_CACHE_TTL_MS", "59999"],
    ["EDGE_VOICES_TIMEOUT_MS", "999"],
    ["EDGE_SETUP_TIMEOUT_MS", "600001"],
    ["EDGE_AUDIO_IDLE_TIMEOUT_MS", "soon"],
  ])("rejects out-of-range %s=%j", (name, value) => {
    expect(configError({ [name]: value }).issues).toEqual([expect.stringContaining(name)]);
  });

  it("reports every invalid variable at once without echoing secrets", () => {
    const secret = "short secret";
    const error = configError({
      PORT: "0",
      HOST: "",
      API_KEY: secret,
      SPEECH_RATE_LIMIT_MAX: "0",
      SERVE_STATIC: "1",
      TRUST_PROXY: " ",
      SYNTHESIS_MAX_QUEUED: "-1",
    });
    expect(error.issues).toHaveLength(7);
    for (const name of ["PORT", "HOST", "API_KEY", "SPEECH_RATE_LIMIT_MAX", "SERVE_STATIC"]) {
      expect(error.message).toContain(name);
    }
    expect(error.message).toContain("TRUST_PROXY");
    expect(error.message).toContain("SYNTHESIS_MAX_QUEUED");
    expect(error.message).not.toContain(secret);
  });

  it("rejects a non-boolean METRICS_ENABLED", () => {
    expect(configError({ METRICS_ENABLED: "1" }).issues).toEqual([
      "METRICS_ENABLED must be either 'true' or 'false'",
    ]);
  });

  it("rejects an unknown SPEECH_RATE_LIMIT_SCOPE", () => {
    expect(configError({ SPEECH_RATE_LIMIT_SCOPE: "tenant" }).issues).toEqual([
      "SPEECH_RATE_LIMIT_SCOPE must be either 'global' or 'ip'",
    ]);
  });

  it("reports an invalid REQUIRE_API_KEY once", () => {
    expect(configError({ REQUIRE_API_KEY: "yes" }).issues).toEqual([
      "REQUIRE_API_KEY must be either 'true' or 'false'",
    ]);
  });
});

describe("createProductionDependencies", () => {
  it("passes service and provider tuning through to their constructors", () => {
    expect(() => createProductionDependencies()).not.toThrow();
    expect(() =>
      createProductionDependencies({ service: { maxConcurrentSyntheses: 0 }, provider: {} }),
    ).toThrow("maxConcurrentSyntheses must be a finite integer >= 1");
    expect(() =>
      createProductionDependencies({ service: {}, provider: { setupTimeoutMs: 0 } }),
    ).toThrow("setupTimeoutMs must be a positive integer");
  });
});

describe("createApp transport options", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  function createRecordingService(): { service: TtsServicePort; requests: SynthesisRequest[] } {
    const requests: SynthesisRequest[] = [];
    const service: TtsServicePort = {
      listVoices: () => Promise.resolve([]),
      synthesize: () => Promise.reject(new Error("unexpected synthesize")),
      synthesizeSegmented: (request) => {
        requests.push(request);
        return Promise.resolve({
          format: "mp3-48k",
          contentType: "audio/mpeg",
          segmentCount: 1,
          audio: (async function* () {
            yield new Uint8Array([1]);
          })(),
        });
      },
    };
    return { service, requests };
  }

  async function clientIp(options?: Parameters<typeof createApp>[1]): Promise<string> {
    app = createApp({ ttsService: createRecordingService().service }, options);
    app.get("/__test/ip", (request) => ({ ip: request.ip }));
    const response = await app.inject({
      method: "GET",
      url: "/__test/ip",
      remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    return response.json<{ ip: string }>().ip;
  }

  it("ignores forwarded client addresses by default", async () => {
    expect(await clientIp()).toBe("127.0.0.1");
  });

  it("uses forwarded client addresses only from trusted proxies", async () => {
    expect(await clientIp({ trustProxy: ["127.0.0.1"] })).toBe("203.0.113.7");
    await app?.close();
    expect(await clientIp({ trustProxy: ["10.0.0.1"] })).toBe("127.0.0.1");
    await app?.close();
    expect(await clientIp({ trustProxy: 1 })).toBe("203.0.113.7");
  });

  it("fails app creation for an invalid trusted proxy address", () => {
    expect(() =>
      createApp(
        { ttsService: createRecordingService().service },
        { trustProxy: ["not-an-address"] },
      ),
    ).toThrow();
  });

  it("accepts the largest valid native request and rejects bodies above the limit", async () => {
    const recording = createRecordingService();
    app = createApp({ ttsService: recording.service });
    // JSON-escape one astral code point as a surrogate pair, the worst case per code point.
    const escapedAstral = "\\u" + "d83d" + "\\u" + "de00";
    const maximal = `{"input":"${escapedAstral.repeat(MAX_NATIVE_INPUT_CODE_POINTS)}","voice":"zh-CN-XiaoxiaoNeural","quality":"high","speed":2,"pitchSemitones":-12,"volume":0.5}`;
    expect(maximal.length).toBeLessThanOrEqual(MAX_REQUEST_BODY_BYTES);

    const accepted = await app.inject({
      method: "POST",
      url: "/api/speech",
      headers: { "content-type": "application/json" },
      payload: maximal,
    });
    expect(accepted.statusCode).toBe(200);
    expect(countCodePoints(recording.requests[0]!.text)).toBe(MAX_NATIVE_INPUT_CODE_POINTS);

    const oversized = await app.inject({
      method: "POST",
      url: "/api/speech",
      headers: { "content-type": "application/json" },
      payload: `{"input":"${"x".repeat(MAX_REQUEST_BODY_BYTES)}","voice":"zh-CN-XiaoxiaoNeural"}`,
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json<{ error: { code: string } }>().error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});
