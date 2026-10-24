import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { TtsError } from "@edgetts/tts-core";
import { createApp } from "../src/app.js";
import type { TtsServicePort } from "../src/dependencies.js";

const REQUESTS = [
  {
    url: "/v1/audio/speech",
    payload: { model: "tts-1", voice: "zh-CN-XiaoxiaoNeural", input: "hello" },
  },
  { url: "/api/speech", payload: { voice: "zh-CN-XiaoxiaoNeural", input: "hello" } },
];

function failingService(error: Error): TtsServicePort {
  return {
    listVoices: () => Promise.resolve([]),
    synthesize: () => Promise.reject(new Error("unexpected synthesize")),
    synthesizeSegmented: () => Promise.reject(error),
  };
}

describe("speech route domain error mapping", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it.each(REQUESTS)("maps capacity_exceeded by code, not class, on $url", async (request) => {
    // A bare TtsError, not SynthesisQueueFullError: routes must depend on the domain code only.
    app = createApp({ ttsService: failingService(new TtsError("capacity_exceeded", "full")) });

    const response = await app.inject({ method: "POST", ...request });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: { code: "SERVER_BUSY", message: "Speech synthesis capacity is full" },
    });
  });

  it.each(REQUESTS)("maps unknown_voice to 400 UNKNOWN_VOICE on $url", async (request) => {
    app = createApp({ ttsService: failingService(new TtsError("unknown_voice", "missing")) });

    const response = await app.inject({ method: "POST", ...request });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: "UNKNOWN_VOICE", message: "Unknown voice" } });
  });

  it.each(REQUESTS)("maps other failures to UPSTREAM_ERROR on $url", async (request) => {
    app = createApp({ ttsService: failingService(new Error("upstream exploded")) });

    const response = await app.inject({ method: "POST", ...request });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      error: { code: "UPSTREAM_ERROR", message: "Unable to synthesize speech" },
    });
  });

  it.each(REQUESTS)("maps first-read failures to UPSTREAM_ERROR on $url", async (request) => {
    const service = failingService(new Error("unexpected setup failure"));
    app = createApp({
      ttsService: {
        ...service,
        synthesizeSegmented: async () => ({
          format: "mp3-48k",
          contentType: "audio/mpeg",
          segmentCount: 1,
          audio: (async function* () {
            yield await Promise.reject<Uint8Array>(new Error("upstream first read failed"));
          })(),
        }),
      },
    });

    const response = await app.inject({ method: "POST", ...request });

    expect(response.statusCode).toBe(502);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual({
      error: { code: "UPSTREAM_ERROR", message: "Unable to synthesize speech" },
    });
  });

  it.each(REQUESTS)(
    "rejects an empty audio stream on $url before success headers",
    async (request) => {
      app = createApp({
        ttsService: {
          ...failingService(new Error("unexpected setup failure")),
          synthesizeSegmented: async () => ({
            format: "mp3-48k",
            contentType: "audio/mpeg",
            segmentCount: 1,
            audio: (async function* () {
              yield* [];
            })(),
          }),
        },
      });

      const response = await app.inject({ method: "POST", ...request });

      expect(response.statusCode).toBe(502);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.json()).toEqual({
        error: { code: "UPSTREAM_ERROR", message: "Unable to synthesize speech" },
      });
    },
  );
});
