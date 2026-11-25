import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SynthesisResult, TtsVoice } from "@edgetts/tts-core";
import type { SegmentedSynthesisResult } from "@edgetts/tts-service";
import { ApiErrorSchema, VoicesResponseSchema } from "@edgetts/shared";
import { createApp } from "../src/app.js";
import type { TtsServicePort } from "../src/dependencies.js";

class FakeTtsService implements TtsServicePort {
  public listVoicesCalls = 0;
  public voicesToReturn: readonly TtsVoice[] = [
    {
      id: "zh-CN-XiaoxiaoNeural",
      displayName: "Microsoft Xiaoxiao",
      locale: "zh-CN",
      gender: "Female",
      status: "GA",
      suggestedCodec: "audio-24khz-48kbitrate-mono-mp3",
    },
    {
      id: "en-US-JennyNeural",
      displayName: "Microsoft Jenny",
      locale: "en-US",
      gender: "Female",
    },
  ];
  public errorToThrow?: Error | undefined;

  async listVoices(): Promise<readonly TtsVoice[]> {
    this.listVoicesCalls++;
    if (this.errorToThrow) {
      throw this.errorToThrow;
    }
    return this.voicesToReturn;
  }

  async synthesize(): Promise<SynthesisResult> {
    return {
      format: "mp3-48k",
      contentType: "audio/mpeg",
      audio: (async function* () {})(),
    };
  }

  async synthesizeSegmented(): Promise<SegmentedSynthesisResult> {
    return {
      format: "mp3-48k",
      contentType: "audio/mpeg",
      segmentCount: 1,
      audio: (async function* () {})(),
    };
  }
}

describe("GET /api/voices", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("returns HTTP 200 and schema-valid voices response on success", async () => {
    const fakeService = new FakeTtsService();
    app = createApp({ ttsService: fakeService });

    const response = await app.inject({
      method: "GET",
      url: "/api/voices",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");

    const json: unknown = response.json();
    const parsed = VoicesResponseSchema.parse(json);

    expect(fakeService.listVoicesCalls).toBe(1);
    expect(parsed.voices.length).toBe(2);
    expect(parsed.voices[0]?.id).toBe("zh-CN-XiaoxiaoNeural");
  });

  it("maps domain fields correctly and does not leak upstream raw fields", async () => {
    const fakeService = new FakeTtsService();
    app = createApp({ ttsService: fakeService });

    const response = await app.inject({
      method: "GET",
      url: "/api/voices",
    });

    expect(response.statusCode).toBe(200);
    const json = response.json() as { voices: Array<Record<string, unknown>> };
    const firstVoice = json.voices[0];

    expect(firstVoice).toEqual({
      id: "zh-CN-XiaoxiaoNeural",
      displayName: "Microsoft Xiaoxiao",
      locale: "zh-CN",
      gender: "Female",
      status: "GA",
      suggestedCodec: "audio-24khz-48kbitrate-mono-mp3",
    });

    expect(firstVoice?.["ShortName"]).toBeUndefined();
    expect(firstVoice?.["FriendlyName"]).toBeUndefined();
    expect(firstVoice?.["Name"]).toBeUndefined();
  });

  it("omits optional status and suggestedCodec when undefined in domain voice", async () => {
    const fakeService = new FakeTtsService();
    app = createApp({ ttsService: fakeService });

    const response = await app.inject({
      method: "GET",
      url: "/api/voices",
    });

    expect(response.statusCode).toBe(200);
    const json = response.json() as { voices: Array<Record<string, unknown>> };
    const secondVoice = json.voices[1];

    expect(secondVoice).toEqual({
      id: "en-US-JennyNeural",
      displayName: "Microsoft Jenny",
      locale: "en-US",
      gender: "Female",
    });

    expect(secondVoice).not.toHaveProperty("status");
    expect(secondVoice).not.toHaveProperty("suggestedCodec");
  });

  it("returns HTTP 200 with empty voices array when provider returns empty list", async () => {
    const fakeService = new FakeTtsService();
    fakeService.voicesToReturn = [];
    app = createApp({ ttsService: fakeService });

    const response = await app.inject({
      method: "GET",
      url: "/api/voices",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ voices: [] });
  });

  it("returns HTTP 502 with UPSTREAM_ERROR and does not leak internal error details", async () => {
    const fakeService = new FakeTtsService();
    fakeService.errorToThrow = new Error("secret internal upstream detail: token=xyz123");
    app = createApp({ ttsService: fakeService });

    const response = await app.inject({
      method: "GET",
      url: "/api/voices",
    });

    expect(response.statusCode).toBe(502);
    expect(response.headers["content-type"]).toContain("application/json");

    const json: unknown = response.json();
    const parsed = ApiErrorSchema.parse(json);

    expect(parsed).toEqual({
      error: {
        code: "UPSTREAM_ERROR",
        message: "Unable to retrieve voices",
      },
    });

    expect(response.body).not.toContain("secret internal upstream detail");
    expect(response.body).not.toContain("token=xyz123");
  });

  it("does not force refresh even if query parameter forceRefresh is passed", async () => {
    const fakeService = new FakeTtsService();
    app = createApp({ ttsService: fakeService });

    const response = await app.inject({
      method: "GET",
      url: "/api/voices?forceRefresh=true",
    });

    expect(response.statusCode).toBe(200);
    expect(fakeService.listVoicesCalls).toBe(1);
  });

  it("ignores unknown query parameters and returns full voice list", async () => {
    const fakeService = new FakeTtsService();
    app = createApp({ ttsService: fakeService });

    const response = await app.inject({
      method: "GET",
      url: "/api/voices?locale=zh-CN&sort=name",
    });

    expect(response.statusCode).toBe(200);
    const json = response.json() as { voices: unknown[] };
    expect(json.voices.length).toBe(2);
  });

  it("compresses the catalog for clients that accept br or gzip", async () => {
    app = createApp({ ttsService: new FakeTtsService() });
    const plain = await app.inject({ method: "GET", url: "/api/voices" });

    const br = await app.inject({
      method: "GET",
      url: "/api/voices",
      headers: { "accept-encoding": "gzip, deflate, br" },
    });
    const gzip = await app.inject({
      method: "GET",
      url: "/api/voices",
      headers: { "accept-encoding": "gzip" },
    });

    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(br.headers["content-encoding"]).toBe("br");
    expect(gzip.headers["content-encoding"]).toBe("gzip");
    expect(brotliDecompressSync(br.rawPayload).toString()).toBe(plain.body);
    expect(gunzipSync(gzip.rawPayload).toString()).toBe(plain.body);
    for (const response of [plain, br, gzip]) {
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.headers["vary"]).toContain("Accept-Encoding");
      expect(response.headers["cache-control"]).toBe("private, no-cache");
      expect(response.headers["etag"]).toBe(plain.headers["etag"]);
    }
  });

  it("answers 304 without a body while If-None-Match names the current catalog", async () => {
    const fakeService = new FakeTtsService();
    app = createApp({ ttsService: fakeService });
    const first = await app.inject({ method: "GET", url: "/api/voices" });
    const etag = String(first.headers["etag"]);

    const unchanged = await app.inject({
      method: "GET",
      url: "/api/voices",
      headers: { "if-none-match": etag },
    });
    expect(unchanged.statusCode).toBe(304);
    expect(unchanged.body).toBe("");
    expect(unchanged.headers["etag"]).toBe(etag);

    fakeService.voicesToReturn = fakeService.voicesToReturn.slice(0, 1);
    const changed = await app.inject({
      method: "GET",
      url: "/api/voices",
      headers: { "if-none-match": etag },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.headers["etag"]).not.toBe(etag);
    expect(VoicesResponseSchema.parse(changed.json()).voices).toHaveLength(1);
  });
});
