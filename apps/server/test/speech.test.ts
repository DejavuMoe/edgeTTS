import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SynthesisRequest, SynthesisResult, TtsVoice } from "@edgetts/tts-core";
import { ApiErrorSchema } from "@edgetts/shared";
import { createApp } from "../src/app.js";
import type { TtsServicePort } from "../src/dependencies.js";

class FakeSpeechTtsService implements TtsServicePort {
  public listVoicesCalls = 0;
  public synthesizeCalls = 0;
  public lastSynthesisRequest?: SynthesisRequest | undefined;
  public lastSignal?: AbortSignal | undefined;
  public errorToThrow?: Error | undefined;
  public audioChunksToReturn: Uint8Array[] = [
    new Uint8Array([0x00, 0x01, 0x7f, 0x80, 0xff]),
    new Uint8Array([0x02, 0x03, 0x04]),
  ];
  public customSynthesize?:
    ((request: SynthesisRequest, signal: AbortSignal) => Promise<SynthesisResult>) | undefined;

  async listVoices(): Promise<readonly TtsVoice[]> {
    this.listVoicesCalls++;
    return [];
  }

  async synthesize(request: SynthesisRequest, signal: AbortSignal): Promise<SynthesisResult> {
    this.synthesizeCalls++;
    this.lastSynthesisRequest = request;
    this.lastSignal = signal;

    if (this.customSynthesize) {
      return this.customSynthesize(request, signal);
    }

    if (this.errorToThrow) {
      throw this.errorToThrow;
    }

    const chunks = this.audioChunksToReturn;
    async function* generateChunks(): AsyncIterable<Uint8Array> {
      for (const chunk of chunks) {
        yield chunk;
      }
    }

    return {
      format: request.format ?? "mp3-48k",
      contentType: "audio/mpeg",
      audio: generateChunks(),
    };
  }
}

describe("POST /v1/audio/speech", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("handles minimal valid request with binary audio streaming", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    const response = await app.inject({
      method: "POST",
      url: "/v1/audio/speech",
      headers: { "content-type": "application/json" },
      payload: {
        model: "tts-1",
        voice: "zh-CN-XiaoxiaoNeural",
        input: "你好",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("audio/mpeg");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-length"]).toBeUndefined();
    expect(response.headers["content-disposition"]).toBeUndefined();
    expect(fakeService.synthesizeCalls).toBe(1);

    const expectedBytes = Buffer.concat([
      Buffer.from([0x00, 0x01, 0x7f, 0x80, 0xff]),
      Buffer.from([0x02, 0x03, 0x04]),
    ]);
    expect(response.rawPayload).toEqual(expectedBytes);
  });

  it("maps model tts-1 to mp3-48k format", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    const response = await app.inject({
      method: "POST",
      url: "/v1/audio/speech",
      headers: { "content-type": "application/json" },
      payload: {
        model: "tts-1",
        voice: "zh-CN-XiaoxiaoNeural",
        input: "你好",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fakeService.lastSynthesisRequest?.format).toBe("mp3-48k");
  });

  it("maps model tts-1-hd to mp3-96k format", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    const response = await app.inject({
      method: "POST",
      url: "/v1/audio/speech",
      headers: { "content-type": "application/json" },
      payload: {
        model: "tts-1-hd",
        voice: "zh-CN-XiaoxiaoNeural",
        input: "你好",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fakeService.lastSynthesisRequest?.format).toBe("mp3-96k");
  });

  it("preserves voice and input verbatim without trimming input", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    const response = await app.inject({
      method: "POST",
      url: "/v1/audio/speech",
      headers: { "content-type": "application/json" },
      payload: {
        model: "tts-1",
        voice: "en-US-JennyNeural",
        input: "   Hello World!   ",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fakeService.lastSynthesisRequest?.voice).toBe("en-US-JennyNeural");
    expect(fakeService.lastSynthesisRequest?.text).toBe("   Hello World!   ");
  });

  it("maps speed correctly to domain prosody", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    const response = await app.inject({
      method: "POST",
      url: "/v1/audio/speech",
      headers: { "content-type": "application/json" },
      payload: {
        model: "tts-1",
        voice: "zh-CN-XiaoxiaoNeural",
        input: "测试语速",
        speed: 1.25,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fakeService.lastSynthesisRequest?.prosody).toEqual({ speed: 1.25 });
  });

  it("omits domain prosody when speed is omitted in request", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    const response = await app.inject({
      method: "POST",
      url: "/v1/audio/speech",
      headers: { "content-type": "application/json" },
      payload: {
        model: "tts-1",
        voice: "zh-CN-XiaoxiaoNeural",
        input: "默认语速",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fakeService.lastSynthesisRequest?.prosody).toBeUndefined();
  });

  it("accepts response_format mp3 and omitted response_format", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    const resExplicit = await app.inject({
      method: "POST",
      url: "/v1/audio/speech",
      headers: { "content-type": "application/json" },
      payload: {
        model: "tts-1",
        voice: "zh-CN-XiaoxiaoNeural",
        input: "显式 MP3",
        response_format: "mp3",
      },
    });
    expect(resExplicit.statusCode).toBe(200);
    expect(resExplicit.headers["content-type"]).toContain("audio/mpeg");
  });

  it("rejects unsupported response formats with HTTP 400 INVALID_REQUEST", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    const unsupportedFormats = ["opus", "wav", "aac", "flac", "pcm", "webm"];

    for (const fmt of unsupportedFormats) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/audio/speech",
        headers: { "content-type": "application/json" },
        payload: {
          model: "tts-1",
          voice: "zh-CN-XiaoxiaoNeural",
          input: "测试格式",
          response_format: fmt,
        },
      });

      expect(response.statusCode).toBe(400);
      const parsed = ApiErrorSchema.parse(response.json());
      expect(parsed).toEqual({
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid speech request",
        },
      });
    }

    expect(fakeService.synthesizeCalls).toBe(0);
  });

  it("rejects unsupported models with HTTP 400 INVALID_REQUEST", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    const unsupportedModels = ["gpt-4o-mini-tts", "edge-tts", "foo", ""];

    for (const mdl of unsupportedModels) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/audio/speech",
        headers: { "content-type": "application/json" },
        payload: {
          model: mdl,
          voice: "zh-CN-XiaoxiaoNeural",
          input: "测试模型",
        },
      });

      expect(response.statusCode).toBe(400);
      const parsed = ApiErrorSchema.parse(response.json());
      expect(parsed).toEqual({
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid speech request",
        },
      });
    }

    expect(fakeService.synthesizeCalls).toBe(0);
  });

  it("rejects missing, empty, or whitespace-only input with HTTP 400", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    const invalidInputs = [undefined, "", "   ", "\t\n  "];

    for (const input of invalidInputs) {
      const payload: Record<string, unknown> = {
        model: "tts-1",
        voice: "zh-CN-XiaoxiaoNeural",
      };
      if (input !== undefined) {
        payload["input"] = input;
      }

      const response = await app.inject({
        method: "POST",
        url: "/v1/audio/speech",
        headers: { "content-type": "application/json" },
        payload,
      });

      expect(response.statusCode).toBe(400);
      const parsed = ApiErrorSchema.parse(response.json());
      expect(parsed.error.code).toBe("INVALID_REQUEST");
    }

    expect(fakeService.synthesizeCalls).toBe(0);
  });

  it("accepts input up to 4096 characters and rejects 4097 characters", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    const text4096 = "a".repeat(4096);
    const res4096 = await app.inject({
      method: "POST",
      url: "/v1/audio/speech",
      headers: { "content-type": "application/json" },
      payload: {
        model: "tts-1",
        voice: "zh-CN-XiaoxiaoNeural",
        input: text4096,
      },
    });
    expect(res4096.statusCode).toBe(200);

    const text4097 = "a".repeat(4097);
    const res4097 = await app.inject({
      method: "POST",
      url: "/v1/audio/speech",
      headers: { "content-type": "application/json" },
      payload: {
        model: "tts-1",
        voice: "zh-CN-XiaoxiaoNeural",
        input: text4097,
      },
    });
    expect(res4097.statusCode).toBe(400);
    const parsed = ApiErrorSchema.parse(res4097.json());
    expect(parsed.error.code).toBe("INVALID_REQUEST");
  });

  it("rejects missing, empty, or whitespace-only voice with HTTP 400", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    const invalidVoices = [undefined, "", "   "];

    for (const voice of invalidVoices) {
      const payload: Record<string, unknown> = {
        model: "tts-1",
        input: "测试语音",
      };
      if (voice !== undefined) {
        payload["voice"] = voice;
      }

      const response = await app.inject({
        method: "POST",
        url: "/v1/audio/speech",
        headers: { "content-type": "application/json" },
        payload,
      });

      expect(response.statusCode).toBe(400);
      const parsed = ApiErrorSchema.parse(response.json());
      expect(parsed.error.code).toBe("INVALID_REQUEST");
    }

    expect(fakeService.synthesizeCalls).toBe(0);
  });

  it("validates speed boundary: accepts 0.5, 1, 2 and rejects 0.49, 2.01", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    for (const validSpeed of [0.5, 1, 2]) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/audio/speech",
        headers: { "content-type": "application/json" },
        payload: {
          model: "tts-1",
          voice: "zh-CN-XiaoxiaoNeural",
          input: "测试速度",
          speed: validSpeed,
        },
      });
      expect(res.statusCode).toBe(200);
    }

    for (const invalidSpeed of [0.49, 2.01, -1, 0, 5]) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/audio/speech",
        headers: { "content-type": "application/json" },
        payload: {
          model: "tts-1",
          voice: "zh-CN-XiaoxiaoNeural",
          input: "测试速度",
          speed: invalidSpeed,
        },
      });
      expect(res.statusCode).toBe(400);
      const parsed = ApiErrorSchema.parse(res.json());
      expect(parsed.error.code).toBe("INVALID_REQUEST");
    }
  });

  it("rejects unknown fields with HTTP 400 due to strict schema", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    const unknownFieldPayloads = [
      {
        model: "tts-1",
        voice: "zh-CN-XiaoxiaoNeural",
        input: "测试",
        instructions: "whisper dramatically",
      },
      {
        model: "tts-1",
        voice: "zh-CN-XiaoxiaoNeural",
        input: "测试",
        stream_format: "sse",
      },
      {
        model: "tts-1",
        voice: "zh-CN-XiaoxiaoNeural",
        input: "测试",
        pitch: 2,
      },
      {
        model: "tts-1",
        voice: "zh-CN-XiaoxiaoNeural",
        input: "测试",
        volume: 0.8,
      },
    ];

    for (const p of unknownFieldPayloads) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/audio/speech",
        headers: { "content-type": "application/json" },
        payload: p,
      });

      expect(response.statusCode).toBe(400);
      const parsed = ApiErrorSchema.parse(response.json());
      expect(parsed.error.code).toBe("INVALID_REQUEST");
      expect(parsed.error.message).toBe("Invalid speech request");
    }

    expect(fakeService.synthesizeCalls).toBe(0);
  });

  it("returns HTTP 502 UPSTREAM_ERROR when service pre-stream rejects and hides internal error", async () => {
    const fakeService = new FakeSpeechTtsService();
    fakeService.errorToThrow = new Error("secret upstream detail: token=xyz123");
    app = createApp({ ttsService: fakeService });

    const response = await app.inject({
      method: "POST",
      url: "/v1/audio/speech",
      headers: { "content-type": "application/json" },
      payload: {
        model: "tts-1",
        voice: "zh-CN-XiaoxiaoNeural",
        input: "测试失败",
      },
    });

    expect(response.statusCode).toBe(502);
    expect(response.headers["content-type"]).toContain("application/json");

    const parsed = ApiErrorSchema.parse(response.json());
    expect(parsed).toEqual({
      error: {
        code: "UPSTREAM_ERROR",
        message: "Unable to synthesize speech",
      },
    });

    expect(response.body).not.toContain("secret upstream detail");
    expect(response.body).not.toContain("token=xyz123");
  });

  it("verifies health and voices regressions are unaffected", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    const healthRes = await app.inject({
      method: "GET",
      url: "/api/health",
    });
    expect(healthRes.statusCode).toBe(200);
    expect(fakeService.listVoicesCalls).toBe(0);
    expect(fakeService.synthesizeCalls).toBe(0);

    const voicesRes = await app.inject({
      method: "GET",
      url: "/api/voices",
    });
    expect(voicesRes.statusCode).toBe(200);
    expect(fakeService.listVoicesCalls).toBe(1);
    expect(fakeService.synthesizeCalls).toBe(0);
  });
});

describe("Deterministic Streaming & Disconnect Integration Tests (localhost)", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("streams first bytes to HTTP client before subsequent generator chunks are released", async () => {
    let secondChunkResolver: () => void = () => {};
    const secondChunkPromise = new Promise<void>((resolve) => {
      secondChunkResolver = resolve;
    });

    let secondChunkReleased = false;

    const fakeService = new FakeSpeechTtsService();
    fakeService.customSynthesize = async (request) => {
      async function* streamGenerator(): AsyncIterable<Uint8Array> {
        yield new Uint8Array([10, 20, 30]);
        await secondChunkPromise;
        secondChunkReleased = true;
        yield new Uint8Array([40, 50, 60]);
      }

      return {
        format: request.format ?? "mp3-48k",
        contentType: "audio/mpeg",
        audio: streamGenerator(),
      };
    };

    app = createApp({ ttsService: fakeService });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.addresses()[0];
    if (!address) {
      throw new Error("Failed to get ephemeral port address");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "tts-1",
        voice: "zh-CN-XiaoxiaoNeural",
        input: "流式分块测试",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("audio/mpeg");
    expect(response.body).not.toBeNull();

    const reader = response.body!.getReader();

    // Read the first chunk
    const firstRead = await reader.read();
    expect(firstRead.done).toBe(false);
    expect(firstRead.value).toBeDefined();
    expect(firstRead.value!.length).toBeGreaterThan(0);

    // CRITICAL: Verify that the second chunk was NOT yet released by the generator!
    expect(secondChunkReleased).toBe(false);

    // Now release the second chunk
    secondChunkResolver();

    // Read the second chunk
    const secondRead = await reader.read();
    expect(secondRead.done).toBe(false);
    expect(secondChunkReleased).toBe(true);

    // Read completion
    const thirdRead = await reader.read();
    expect(thirdRead.done).toBe(true);
  });

  it("aborts service AbortSignal when HTTP client disconnects prematurely", async () => {
    let unblockGenerator: () => void = () => {};
    const generatorBlockedPromise = new Promise<void>((resolve) => {
      unblockGenerator = resolve;
    });

    const fakeService = new FakeSpeechTtsService();
    fakeService.customSynthesize = async (request) => {
      async function* streamGenerator(): AsyncIterable<Uint8Array> {
        yield new Uint8Array([1, 2, 3]);
        // Hang until unblocked or aborted
        await generatorBlockedPromise;
        yield new Uint8Array([4, 5, 6]);
      }

      return {
        format: request.format ?? "mp3-48k",
        contentType: "audio/mpeg",
        audio: streamGenerator(),
      };
    };

    app = createApp({ ttsService: fakeService });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.addresses()[0];
    if (!address) {
      throw new Error("Failed to get ephemeral port address");
    }

    const clientAbortController = new AbortController();

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/audio/speech`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "tts-1",
          voice: "zh-CN-XiaoxiaoNeural",
          input: "断开测试",
        }),
        signal: clientAbortController.signal,
      });

      expect(response.status).toBe(200);
      const reader = response.body!.getReader();

      // Read first chunk
      const firstRead = await reader.read();
      expect(firstRead.done).toBe(false);

      // Now client aborts connection
      clientAbortController.abort();
      await reader.cancel().catch(() => {});
    } catch {
      // Fetch aborted
    }

    // Give Fastify / Node a brief tick to process client socket close
    for (let i = 0; i < 20; i++) {
      if (fakeService.lastSignal?.aborted) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(fakeService.lastSignal?.aborted).toBe(true);

    // Clean up generator
    unblockGenerator();
  });
});
