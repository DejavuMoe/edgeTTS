import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SynthesisRequest, SynthesisResult, TtsProvider, TtsVoice } from "@edgetts/tts-core";
import { ApiErrorSchema } from "@edgetts/shared";
import {
  segmentText,
  SynthesisQueueFullError,
  TtsService,
  type SegmentedSynthesisOptions,
} from "@edgetts/tts-service";
import { createApp } from "../src/app.js";
import type { TtsServicePort } from "../src/dependencies.js";

class FakeSpeechTtsService implements TtsServicePort {
  public listVoicesCalls = 0;
  public synthesizeCalls = 0;
  public synthesizeSegmentedCalls = 0;
  public lastSynthesisRequest?: SynthesisRequest | undefined;
  public lastSegmentedRequest?: SynthesisRequest | undefined;
  public lastSegmentedOptions?: SegmentedSynthesisOptions | undefined;
  public lastSignal?: AbortSignal | undefined;
  public errorToThrow?: Error | undefined;
  public audioChunksToReturn: Uint8Array[] = [
    new Uint8Array([0x00, 0x01, 0x7f, 0x80, 0xff]),
    new Uint8Array([0x02, 0x03, 0x04]),
  ];
  public customSynthesize?:
    ((request: SynthesisRequest, signal: AbortSignal) => Promise<SynthesisResult>) | undefined;
  public customSynthesizeSegmented?:
    | ((
        request: SynthesisRequest,
        signal: AbortSignal,
        options: SegmentedSynthesisOptions,
      ) => Promise<SynthesisResult>)
    | undefined;

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

  async synthesizeSegmented(
    request: SynthesisRequest,
    signal: AbortSignal,
    options: SegmentedSynthesisOptions,
  ): Promise<SynthesisResult> {
    this.synthesizeSegmentedCalls++;
    this.lastSegmentedRequest = request;
    this.lastSegmentedOptions = options;
    this.lastSignal = signal;

    if (this.customSynthesizeSegmented) {
      return this.customSynthesizeSegmented(request, signal, options);
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

  it("returns HTTP 503 SERVER_BUSY when service throws SynthesisQueueFullError", async () => {
    const fakeService = new FakeSpeechTtsService();
    fakeService.errorToThrow = new SynthesisQueueFullError();
    app = createApp({ ttsService: fakeService });

    const response = await app.inject({
      method: "POST",
      url: "/v1/audio/speech",
      headers: { "content-type": "application/json" },
      payload: {
        model: "tts-1",
        voice: "zh-CN-XiaoxiaoNeural",
        input: "队列已满测试",
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["content-type"]).toContain("application/json");

    const parsed = ApiErrorSchema.parse(response.json());
    expect(parsed).toEqual({
      error: {
        code: "SERVER_BUSY",
        message: "Speech synthesis capacity is full",
      },
    });
  });

  it("rejects concurrency request parameter with HTTP 400 INVALID_REQUEST", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    const response = await app.inject({
      method: "POST",
      url: "/v1/audio/speech",
      headers: { "content-type": "application/json" },
      payload: {
        model: "tts-1",
        voice: "zh-CN-XiaoxiaoNeural",
        input: "测试并发参数",
        concurrency: 100,
      },
    });

    expect(response.statusCode).toBe(400);
    const parsed = ApiErrorSchema.parse(response.json());
    expect(parsed.error.code).toBe("INVALID_REQUEST");
    expect(fakeService.synthesizeCalls).toBe(0);
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

  it("releases concurrency permit when HTTP client disconnects so queued request can proceed", async () => {
    class FakeIntegrationProvider implements TtsProvider {
      public callOrder: string[] = [];
      public blockedStreamResolver: () => void = () => {};

      async listVoices(): Promise<readonly TtsVoice[]> {
        return [];
      }

      async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
        this.callOrder.push(request.text);
        if (request.text === "reqA") {
          const promise = new Promise<void>((resolve) => {
            this.blockedStreamResolver = resolve;
          });
          return {
            format: "mp3-48k",
            contentType: "audio/mpeg",
            audio: (async function* () {
              yield new Uint8Array([1, 2]);
              await promise;
              yield new Uint8Array([3, 4]);
            })(),
          };
        }

        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            yield new Uint8Array([5, 6]);
          })(),
        };
      }
    }

    const provider = new FakeIntegrationProvider();
    const service = new TtsService(provider, {
      maxConcurrentSyntheses: 1,
      maxQueuedSyntheses: 5,
    });

    app = createApp({ ttsService: service });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.addresses()[0]!;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const clientAController = new AbortController();

    // Start request A
    const resA = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "tts-1",
        voice: "zh-CN-XiaoxiaoNeural",
        input: "reqA",
      }),
      signal: clientAController.signal,
    });

    expect(resA.status).toBe(200);
    const readerA = resA.body!.getReader();
    const chunkA = await readerA.read();
    expect(chunkA.done).toBe(false);
    expect(provider.callOrder).toEqual(["reqA"]);

    // Start request B (queued in service because reqA holds slot)
    const resBPromise = fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "tts-1",
        voice: "zh-CN-XiaoxiaoNeural",
        input: "reqB",
      }),
    });

    // Verify reqB not yet dispatched
    await new Promise((r) => setTimeout(r, 20));
    expect(provider.callOrder).toEqual(["reqA"]);

    // Client A aborts
    clientAController.abort();
    await readerA.cancel().catch(() => {});

    // Request B should now acquire slot and be dispatched
    const resB = await resBPromise;
    expect(resB.status).toBe(200);
    expect(provider.callOrder).toEqual(["reqA", "reqB"]);

    const readerB = resB.body!.getReader();
    const chunkB = await readerB.read();
    expect(chunkB.done).toBe(false);
    expect(chunkB.value).toEqual(new Uint8Array([5, 6]));

    provider.blockedStreamResolver();
  });
});

describe("POST /api/speech", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("handles minimal valid native request with binary audio streaming", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    const response = await app.inject({
      method: "POST",
      url: "/api/speech",
      headers: { "content-type": "application/json" },
      payload: {
        voice: "zh-CN-XiaoxiaoNeural",
        input: "你好世界",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("audio/mpeg");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-length"]).toBeUndefined();
    expect(fakeService.synthesizeSegmentedCalls).toBe(1);
    expect(fakeService.synthesizeCalls).toBe(0);
    expect(fakeService.lastSegmentedOptions?.maxSegmentCodePoints).toBe(300);
    expect(fakeService.lastSegmentedRequest?.format).toBe("mp3-48k");
    expect(fakeService.lastSegmentedRequest?.voice).toBe("zh-CN-XiaoxiaoNeural");
    expect(fakeService.lastSegmentedRequest?.text).toBe("你好世界");

    const expectedBytes = Buffer.concat([
      Buffer.from([0x00, 0x01, 0x7f, 0x80, 0xff]),
      Buffer.from([0x02, 0x03, 0x04]),
    ]);
    expect(response.rawPayload).toEqual(expectedBytes);
  });

  it("maps quality standard and high correctly, defaulting to standard (mp3-48k)", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    // Standard
    await app.inject({
      method: "POST",
      url: "/api/speech",
      headers: { "content-type": "application/json" },
      payload: {
        voice: "v",
        input: "text",
        quality: "standard",
      },
    });
    expect(fakeService.lastSegmentedRequest?.format).toBe("mp3-48k");

    // High
    await app.inject({
      method: "POST",
      url: "/api/speech",
      headers: { "content-type": "application/json" },
      payload: {
        voice: "v",
        input: "text",
        quality: "high",
      },
    });
    expect(fakeService.lastSegmentedRequest?.format).toBe("mp3-96k");

    // Default (omitted)
    await app.inject({
      method: "POST",
      url: "/api/speech",
      headers: { "content-type": "application/json" },
      payload: {
        voice: "v",
        input: "text",
      },
    });
    expect(fakeService.lastSegmentedRequest?.format).toBe("mp3-48k");
  });

  it("passes all prosody fields (speed, pitchSemitones, volume) to domain request", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    const response = await app.inject({
      method: "POST",
      url: "/api/speech",
      headers: { "content-type": "application/json" },
      payload: {
        voice: "custom-voice",
        input: "prosody check",
        speed: 1.5,
        pitchSemitones: -6,
        volume: 0.8,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fakeService.lastSegmentedRequest?.prosody).toEqual({
      speed: 1.5,
      pitchSemitones: -6,
      volume: 0.8,
    });
  });

  it("accepts inputs larger than 4096 code points", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    const longText = "a".repeat(5000);
    const response = await app.inject({
      method: "POST",
      url: "/api/speech",
      headers: { "content-type": "application/json" },
      payload: {
        voice: "v",
        input: longText,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fakeService.lastSegmentedRequest?.text.length).toBe(5000);
  });

  it("accepts up to 20,000 code points and rejects 20,001 with 400 INVALID_REQUEST", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    // 20,000 code points -> 200
    const text20k = "a".repeat(20_000);
    const res20k = await app.inject({
      method: "POST",
      url: "/api/speech",
      headers: { "content-type": "application/json" },
      payload: {
        voice: "v",
        input: text20k,
      },
    });
    expect(res20k.statusCode).toBe(200);

    // 20,001 code points -> 400
    const text20001 = "a".repeat(20_001);
    const res20001 = await app.inject({
      method: "POST",
      url: "/api/speech",
      headers: { "content-type": "application/json" },
      payload: {
        voice: "v",
        input: text20001,
      },
    });
    expect(res20001.statusCode).toBe(400);
    const errorJson = JSON.parse(res20001.payload);
    expect(errorJson.error.code).toBe("INVALID_REQUEST");
  });

  it("counts Unicode surrogate pairs (emojis) correctly as single code points", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    // 20,000 emojis = 40,000 UTF-16 code units, but exactly 20,000 code points
    const emoji20k = "😀".repeat(20_000);
    expect(emoji20k.length).toBe(40_000); // UTF-16 length is 40,000

    const res20k = await app.inject({
      method: "POST",
      url: "/api/speech",
      headers: { "content-type": "application/json" },
      payload: {
        voice: "v",
        input: emoji20k,
      },
    });
    expect(res20k.statusCode).toBe(200);

    // 20,001 emojis = 20,001 code points -> rejected!
    const emoji20001 = "😀".repeat(20_001);
    const res20001 = await app.inject({
      method: "POST",
      url: "/api/speech",
      headers: { "content-type": "application/json" },
      payload: {
        voice: "v",
        input: emoji20001,
      },
    });
    expect(res20001.statusCode).toBe(400);
    const errorJson = JSON.parse(res20001.payload);
    expect(errorJson.error.code).toBe("INVALID_REQUEST");
  });

  it("rejects empty and whitespace-only inputs with 400 INVALID_REQUEST", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    for (const invalidInput of ["", "   ", "\t\n  \r\n"]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/speech",
        headers: { "content-type": "application/json" },
        payload: {
          voice: "v",
          input: invalidInput,
        },
      });
      expect(res.statusCode).toBe(400);
      const errorJson = JSON.parse(res.payload);
      expect(errorJson.error.code).toBe("INVALID_REQUEST");
    }
  });

  it("rejects unknown fields via strict schema validation", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    const res = await app.inject({
      method: "POST",
      url: "/api/speech",
      headers: { "content-type": "application/json" },
      payload: {
        voice: "v",
        input: "hello",
        model: "tts-1", // Unknown on native endpoint
      },
    });

    expect(res.statusCode).toBe(400);
    const errorJson = JSON.parse(res.payload);
    expect(errorJson.error.code).toBe("INVALID_REQUEST");
  });

  it("does not mutate or trim input whitespace in the synthesized request", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    const rawInput = "   \nLeading whitespace and trailing whitespace.\n\n  ";
    const res = await app.inject({
      method: "POST",
      url: "/api/speech",
      headers: { "content-type": "application/json" },
      payload: {
        voice: "v",
        input: rawInput,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(fakeService.lastSegmentedRequest?.text).toBe(rawInput);
  });

  it("returns 503 SERVER_BUSY when synthesis capacity is full", async () => {
    const fakeService = new FakeSpeechTtsService();
    fakeService.errorToThrow = new SynthesisQueueFullError("Capacity full");
    app = createApp({ ttsService: fakeService });

    const res = await app.inject({
      method: "POST",
      url: "/api/speech",
      headers: { "content-type": "application/json" },
      payload: {
        voice: "v",
        input: "hello",
      },
    });

    expect(res.statusCode).toBe(503);
    const errorJson = JSON.parse(res.payload);
    expect(errorJson.error.code).toBe("SERVER_BUSY");
  });

  it("returns 502 UPSTREAM_ERROR on unexpected provider failure", async () => {
    const fakeService = new FakeSpeechTtsService();
    fakeService.errorToThrow = new Error("Upstream connection crashed");
    app = createApp({ ttsService: fakeService });

    const res = await app.inject({
      method: "POST",
      url: "/api/speech",
      headers: { "content-type": "application/json" },
      payload: {
        voice: "v",
        input: "hello",
      },
    });

    expect(res.statusCode).toBe(502);
    const errorJson = JSON.parse(res.payload);
    expect(errorJson.error.code).toBe("UPSTREAM_ERROR");
  });

  it("verifies /v1/audio/speech 4096-limit regression is fully preserved", async () => {
    const fakeService = new FakeSpeechTtsService();
    app = createApp({ ttsService: fakeService });

    // 4096 characters accepted on /v1
    const res4096 = await app.inject({
      method: "POST",
      url: "/v1/audio/speech",
      headers: { "content-type": "application/json" },
      payload: {
        model: "tts-1",
        voice: "v",
        input: "a".repeat(4096),
      },
    });
    expect(res4096.statusCode).toBe(200);
    expect(fakeService.synthesizeCalls).toBe(1);
    expect(fakeService.synthesizeSegmentedCalls).toBe(0);

    // 4097 characters rejected on /v1
    const res4097 = await app.inject({
      method: "POST",
      url: "/v1/audio/speech",
      headers: { "content-type": "application/json" },
      payload: {
        model: "tts-1",
        voice: "v",
        input: "a".repeat(4097),
      },
    });
    expect(res4097.statusCode).toBe(400);
    const errorJson = JSON.parse(res4097.payload);
    expect(errorJson.error.code).toBe("INVALID_REQUEST");
  });

  describe("Phase 24: Long-Text Synthesis Status & Streaming Telemetry Headers", () => {
    it("returns segment-count 1 and segment-max 300 for short native input", async () => {
      const fakeService = new FakeSpeechTtsService();
      app = createApp({ ttsService: fakeService });

      const res = await app.inject({
        method: "POST",
        url: "/api/speech",
        headers: { "content-type": "application/json" },
        payload: {
          voice: "zh-CN-XiaoxiaoNeural",
          input: "短文本测试。",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("audio/mpeg");
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-edgetts-segment-count"]).toBe("1");
      expect(res.headers["x-edgetts-segment-max-code-points"]).toBe("300");
      expect(fakeService.synthesizeSegmentedCalls).toBe(1);
    });

    it("returns segment-count matching real segmentText algorithm for long native input", async () => {
      const fakeService = new FakeSpeechTtsService();
      app = createApp({ ttsService: fakeService });

      // Generate a long text with multiple paragraphs exceeding 300 code points
      const paragraph = "这是第一段很长的测试文本，用于验证长文本分段规划响应头信息。".repeat(10);
      const longInput = `${paragraph}\n\n${paragraph}\n\n${paragraph}`;

      const realSegments = segmentText(longInput, { maxCodePoints: 300 });
      expect(realSegments.length).toBeGreaterThan(1);

      const res = await app.inject({
        method: "POST",
        url: "/api/speech",
        headers: { "content-type": "application/json" },
        payload: {
          voice: "zh-CN-XiaoxiaoNeural",
          input: longInput,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-edgetts-segment-count"]).toBe(String(realSegments.length));
      expect(res.headers["x-edgetts-segment-max-code-points"]).toBe("300");
      expect(fakeService.synthesizeSegmentedCalls).toBe(1);
    });

    it("verifies telemetry headers are decimal integer strings with no input text leakage", async () => {
      const fakeService = new FakeSpeechTtsService();
      app = createApp({ ttsService: fakeService });

      const secretText = "SuperSecretConfidentialInputDataThatMustNeverLeakIntoHeaders";
      const res = await app.inject({
        method: "POST",
        url: "/api/speech",
        headers: { "content-type": "application/json" },
        payload: {
          voice: "zh-CN-XiaoxiaoNeural",
          input: secretText,
        },
      });

      expect(res.statusCode).toBe(200);
      const segmentCountHeader = res.headers["x-edgetts-segment-count"];
      const maxCodePointsHeader = res.headers["x-edgetts-segment-max-code-points"];

      expect(typeof segmentCountHeader).toBe("string");
      expect(typeof maxCodePointsHeader).toBe("string");
      expect(/^[1-9]\d*$/.test(segmentCountHeader as string)).toBe(true);
      expect(/^[1-9]\d*$/.test(maxCodePointsHeader as string)).toBe(true);

      // Verify no input text leaks into any response header
      for (const headerValue of Object.values(res.headers)) {
        if (typeof headerValue === "string") {
          expect(headerValue.includes(secretText)).toBe(false);
          expect(headerValue.includes("SuperSecret")).toBe(false);
        }
      }
    });

    it("does not expose native segment telemetry headers on OpenAI /v1/audio/speech", async () => {
      const fakeService = new FakeSpeechTtsService();
      app = createApp({ ttsService: fakeService });

      const res = await app.inject({
        method: "POST",
        url: "/v1/audio/speech",
        headers: { "content-type": "application/json" },
        payload: {
          model: "tts-1",
          voice: "zh-CN-XiaoxiaoNeural",
          input: "OpenAI contract verification.",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("audio/mpeg");
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-edgetts-segment-count"]).toBeUndefined();
      expect(res.headers["x-edgetts-segment-max-code-points"]).toBeUndefined();
    });

    it("does not attach segment headers on 400 invalid native speech requests", async () => {
      const fakeService = new FakeSpeechTtsService();
      app = createApp({ ttsService: fakeService });

      const res = await app.inject({
        method: "POST",
        url: "/api/speech",
        headers: { "content-type": "application/json" },
        payload: {
          voice: "", // Invalid empty voice
          input: "Hello",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(fakeService.synthesizeSegmentedCalls).toBe(0);
      expect(res.headers["x-edgetts-segment-count"]).toBeUndefined();
      expect(res.headers["x-edgetts-segment-max-code-points"]).toBeUndefined();
    });
  });
});
