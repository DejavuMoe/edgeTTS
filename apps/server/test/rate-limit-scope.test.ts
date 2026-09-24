import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp, type AppOptions } from "../src/app.js";
import type { TtsServicePort } from "../src/dependencies.js";

const service: TtsServicePort = {
  listVoices: () => Promise.resolve([]),
  synthesize: () => Promise.reject(new Error("unexpected synthesize")),
  synthesizeSegmented: () =>
    Promise.resolve({
      format: "mp3-48k",
      contentType: "audio/mpeg",
      segmentCount: 1,
      audio: (async function* () {
        yield new Uint8Array([1]);
      })(),
    }),
};

const NATIVE = { url: "/api/speech", payload: { voice: "zh-CN-XiaoxiaoNeural", input: "hi" } };
const OPENAI = {
  url: "/v1/audio/speech",
  payload: { model: "tts-1", voice: "zh-CN-XiaoxiaoNeural", input: "hi" },
};

describe("speech rate limit scope", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  function start(options: AppOptions): FastifyInstance {
    app = createApp({ ttsService: service }, options);
    return app;
  }

  async function status(
    target: FastifyInstance,
    route: typeof NATIVE,
    remoteAddress: string,
    forwardedFor?: string,
  ): Promise<number> {
    const response = await target.inject({
      method: "POST",
      url: route.url,
      payload: route.payload,
      remoteAddress,
      ...(forwardedFor !== undefined ? { headers: { "x-forwarded-for": forwardedFor } } : {}),
    });
    return response.statusCode;
  }

  it("shares one budget across all clients by default", async () => {
    const target = start({ speechRateLimit: { max: 2, timeWindowMs: 60_000 } });

    expect(await status(target, NATIVE, "192.0.2.1")).toBe(200);
    expect(await status(target, NATIVE, "192.0.2.2")).toBe(200);
    expect(await status(target, NATIVE, "192.0.2.3")).toBe(429);
  });

  it("gives each client address its own budget, shared by both speech routes", async () => {
    const target = start({ speechRateLimit: { max: 2, timeWindowMs: 60_000, scope: "ip" } });

    expect(await status(target, NATIVE, "192.0.2.1")).toBe(200);
    expect(await status(target, OPENAI, "192.0.2.1")).toBe(200);
    expect(await status(target, OPENAI, "192.0.2.1")).toBe(429);
    expect(await status(target, NATIVE, "192.0.2.1")).toBe(429);
    expect(await status(target, NATIVE, "192.0.2.2")).toBe(200);
  });

  it("keys forwarded clients separately only behind a trusted proxy", async () => {
    const trusted = start({
      speechRateLimit: { max: 1, timeWindowMs: 60_000, scope: "ip" },
      trustProxy: ["127.0.0.1"],
    });
    expect(await status(trusted, NATIVE, "127.0.0.1", "203.0.113.1")).toBe(200);
    expect(await status(trusted, NATIVE, "127.0.0.1", "203.0.113.2")).toBe(200);
    expect(await status(trusted, NATIVE, "127.0.0.1", "203.0.113.1")).toBe(429);
    await trusted.close();

    // Without trust the forwarded header is ignored, so spoofed addresses share the peer's budget.
    const untrusted = start({ speechRateLimit: { max: 1, timeWindowMs: 60_000, scope: "ip" } });
    expect(await status(untrusted, NATIVE, "127.0.0.1", "203.0.113.1")).toBe(200);
    expect(await status(untrusted, NATIVE, "127.0.0.1", "203.0.113.2")).toBe(429);
  });
});
