import { Readable } from "node:stream";
import { describe, it, expect, vi } from "vitest";
import { OUTPUT_FORMAT, type Voice, type ProsodyOptions } from "msedge-tts";
import type { TtsAudioFormat } from "@edgetts/tts-core";
import { EdgeTtsProvider } from "../src/edge-provider.js";
import type { EdgeClient } from "../src/client.js";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

class FakeEdgeClient implements EdgeClient {
  public closeCallCount = 0;
  public setMetadataCalls: Array<{ voiceName: string; outputFormat: OUTPUT_FORMAT }> = [];
  public toStreamCalls: Array<{ input: string; options?: ProsodyOptions | undefined }> = [];
  public streamToReturn: Readable;
  public getVoicesHandler?: () => Promise<readonly Voice[]>;
  public setMetadataHandler?: (voiceName: string, outputFormat: OUTPUT_FORMAT) => Promise<void>;

  constructor(streamToReturn?: Readable) {
    this.streamToReturn = streamToReturn ?? Readable.from([]);
  }

  async getVoices(): Promise<readonly Voice[]> {
    if (this.getVoicesHandler) {
      return this.getVoicesHandler();
    }
    return [
      {
        ShortName: "zh-CN-XiaoxiaoNeural",
        FriendlyName: "Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)",
        Locale: "zh-CN",
        Gender: "Female",
        Status: "GA",
        SuggestedCodec: "audio-24khz-48kbitrate-mono-mp3",
        Name: "Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoxiaoNeural)",
      },
    ];
  }

  async setMetadata(voiceName: string, outputFormat: OUTPUT_FORMAT): Promise<void> {
    this.setMetadataCalls.push({ voiceName, outputFormat });
    if (this.setMetadataHandler) {
      return this.setMetadataHandler(voiceName, outputFormat);
    }
  }

  toStream(input: string, options?: ProsodyOptions): { audioStream: Readable } {
    this.toStreamCalls.push({ input, options });
    return { audioStream: this.streamToReturn };
  }

  close(): void {
    this.closeCallCount++;
  }
}

describe("EdgeTtsProvider", () => {
  describe("listVoices", () => {
    it("maps upstream voices to domain TtsVoice correctly and closes client", async () => {
      let createdClient: FakeEdgeClient | undefined;
      const provider = new EdgeTtsProvider(() => {
        createdClient = new FakeEdgeClient();
        return createdClient;
      });

      const voices = await provider.listVoices();

      expect(voices).toEqual([
        {
          id: "zh-CN-XiaoxiaoNeural",
          displayName: "Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)",
          locale: "zh-CN",
          gender: "Female",
          status: "GA",
          suggestedCodec: "audio-24khz-48kbitrate-mono-mp3",
        },
      ]);
      expect(createdClient?.closeCallCount).toBe(1);
    });
  });

  describe("format handling", () => {
    it("defaults to mp3-48k with correct OUTPUT_FORMAT and contentType", async () => {
      let createdClient: FakeEdgeClient | undefined;
      const provider = new EdgeTtsProvider(() => {
        createdClient = new FakeEdgeClient();
        return createdClient;
      });

      const ac = new AbortController();
      const result = await provider.synthesize(
        { text: "Hello", voice: "zh-CN-XiaoxiaoNeural" },
        ac.signal,
      );

      expect(result.format).toBe("mp3-48k");
      expect(result.contentType).toBe("audio/mpeg");
      expect(createdClient?.setMetadataCalls[0]).toEqual({
        voiceName: "zh-CN-XiaoxiaoNeural",
        outputFormat: OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
      });
    });

    const formatCases: Array<{
      format: TtsAudioFormat;
      expectedOutputFormat: OUTPUT_FORMAT;
      expectedContentType: "audio/mpeg" | "audio/webm";
    }> = [
      {
        format: "mp3-48k",
        expectedOutputFormat: OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
        expectedContentType: "audio/mpeg",
      },
      {
        format: "mp3-96k",
        expectedOutputFormat: OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3,
        expectedContentType: "audio/mpeg",
      },
      {
        format: "webm-opus",
        expectedOutputFormat: OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS,
        expectedContentType: "audio/webm",
      },
    ];

    for (const testCase of formatCases) {
      it(`correctly maps format ${testCase.format}`, async () => {
        let createdClient: FakeEdgeClient | undefined;
        const provider = new EdgeTtsProvider(() => {
          createdClient = new FakeEdgeClient();
          return createdClient;
        });

        const ac = new AbortController();
        const result = await provider.synthesize(
          { text: "test", voice: "zh-CN-XiaoxiaoNeural", format: testCase.format },
          ac.signal,
        );

        expect(result.format).toBe(testCase.format);
        expect(result.contentType).toBe(testCase.expectedContentType);
        expect(createdClient?.setMetadataCalls[0]?.outputFormat).toBe(
          testCase.expectedOutputFormat,
        );
      });
    }

    it("rejects unsupported format", async () => {
      const provider = new EdgeTtsProvider(() => new FakeEdgeClient());
      const ac = new AbortController();
      await expect(
        provider.synthesize(
          {
            text: "test",
            voice: "zh-CN-XiaoxiaoNeural",
            format: "wav" as unknown as TtsAudioFormat,
          },
          ac.signal,
        ),
      ).rejects.toThrow("Unsupported audio format");
    });
  });

  describe("XML escaping in synthesis", () => {
    it("escapes plain text before passing to client.toStream", async () => {
      let createdClient: FakeEdgeClient | undefined;
      const provider = new EdgeTtsProvider(() => {
        createdClient = new FakeEdgeClient();
        return createdClient;
      });

      const ac = new AbortController();
      await provider.synthesize(
        {
          text: `Tom & Jerry <test> "hello" 'world' <break time="10s"/>`,
          voice: "zh-CN-XiaoxiaoNeural",
        },
        ac.signal,
      );

      expect(createdClient?.toStreamCalls[0]?.input).toBe(
        `Tom &amp; Jerry &lt;test&gt; &quot;hello&quot; &apos;world&apos; &lt;break time=&quot;10s&quot;/&gt;`,
      );
    });
  });

  describe("streaming and chunking", () => {
    it("yields chunks incrementally without whole-buffering", async () => {
      const chunkA = Buffer.from("chunk-A");
      const chunkB = Buffer.from("chunk-B");
      const chunkC = Buffer.from("chunk-C");
      const stream = Readable.from([chunkA, chunkB, chunkC]);

      const provider = new EdgeTtsProvider(() => new FakeEdgeClient(stream));
      const ac = new AbortController();
      const result = await provider.synthesize(
        { text: "Hello stream", voice: "zh-CN-XiaoxiaoNeural" },
        ac.signal,
      );

      const received: string[] = [];
      for await (const chunk of result.audio) {
        expect(chunk).toBeInstanceOf(Uint8Array);
        received.push(Buffer.from(chunk).toString());
      }

      expect(received).toEqual(["chunk-A", "chunk-B", "chunk-C"]);
    });
  });

  describe("cleanup guarantees", () => {
    it("closes client exactly once on normal stream completion", async () => {
      const stream = Readable.from([Buffer.from("data")]);
      let createdClient: FakeEdgeClient | undefined;
      const provider = new EdgeTtsProvider(() => {
        createdClient = new FakeEdgeClient(stream);
        return createdClient;
      });

      const ac = new AbortController();
      const result = await provider.synthesize(
        { text: "test", voice: "zh-CN-XiaoxiaoNeural" },
        ac.signal,
      );

      for await (const chunk of result.audio) {
        void chunk;
      }

      expect(createdClient?.closeCallCount).toBe(1);
    });

    it("closes client exactly once on consumer early break", async () => {
      const stream = Readable.from([Buffer.from("1"), Buffer.from("2"), Buffer.from("3")]);
      let createdClient: FakeEdgeClient | undefined;
      const provider = new EdgeTtsProvider(() => {
        createdClient = new FakeEdgeClient(stream);
        return createdClient;
      });

      const ac = new AbortController();
      const result = await provider.synthesize(
        { text: "test", voice: "zh-CN-XiaoxiaoNeural" },
        ac.signal,
      );

      for await (const chunk of result.audio) {
        void chunk;
        break;
      }

      expect(createdClient?.closeCallCount).toBe(1);
    });

    it("closes client exactly once on upstream stream error", async () => {
      const stream = new Readable({
        read() {
          this.destroy(new Error("Upstream network failure"));
        },
      });
      let createdClient: FakeEdgeClient | undefined;
      const provider = new EdgeTtsProvider(() => {
        createdClient = new FakeEdgeClient(stream);
        return createdClient;
      });

      const ac = new AbortController();
      const result = await provider.synthesize(
        { text: "test", voice: "zh-CN-XiaoxiaoNeural" },
        ac.signal,
      );

      await expect(async () => {
        for await (const chunk of result.audio) {
          void chunk;
        }
      }).rejects.toThrow("Upstream network failure");

      expect(createdClient?.closeCallCount).toBe(1);
    });
  });

  describe("audio resource lifecycle", () => {
    it("closes and destroys an unstarted stream when the consumer returns immediately", async () => {
      const stream = Readable.from([Buffer.from("data")]);
      const client = new FakeEdgeClient(stream);
      const provider = new EdgeTtsProvider(() => client);
      const result = await provider.synthesize(
        { text: "hello", voice: "zh-CN-XiaoxiaoNeural" },
        new AbortController().signal,
      );

      await result.audio[Symbol.asyncIterator]().return?.();

      expect(client.closeCallCount).toBe(1);
      expect(stream.destroyed).toBe(true);
    });

    it("destroys and closes a silent stream after the configured idle timeout", async () => {
      vi.useFakeTimers();
      try {
        const stream = new Readable({ read() {} });
        const client = new FakeEdgeClient(stream);
        const provider = new EdgeTtsProvider({
          clientFactory: () => client,
          audioIdleTimeoutMs: 10,
        });
        const result = await provider.synthesize(
          { text: "hello", voice: "zh-CN-XiaoxiaoNeural" },
          new AbortController().signal,
        );
        const next = result.audio[Symbol.asyncIterator]().next();
        const rejection = expect(next).rejects.toThrow(
          "Speech synthesis audio timed out after 10ms",
        );

        await vi.advanceTimersByTimeAsync(10);

        await rejection;
        expect(client.closeCallCount).toBe(1);
        expect(stream.destroyed).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("cancellation", () => {
    it("rejects immediately with AbortError before starting without creating client", async () => {
      let clientCreated = false;
      const provider = new EdgeTtsProvider(() => {
        clientCreated = true;
        return new FakeEdgeClient();
      });

      const ac = new AbortController();
      ac.abort();

      await expect(
        provider.synthesize({ text: "Hello", voice: "zh-CN-XiaoxiaoNeural" }, ac.signal),
      ).rejects.toSatisfy((err: unknown) => {
        return err instanceof Error && err.name === "AbortError";
      });

      expect(clientCreated).toBe(false);
    });

    it("destroys stream, closes client, and throws AbortError when aborted during streaming", async () => {
      let streamDestroyed = false;
      const stream = new Readable({
        read() {},
        destroy(err, callback) {
          streamDestroyed = true;
          callback(err);
        },
      });

      let createdClient: FakeEdgeClient | undefined;
      const provider = new EdgeTtsProvider(() => {
        createdClient = new FakeEdgeClient(stream);
        return createdClient;
      });

      const ac = new AbortController();
      const result = await provider.synthesize(
        { text: "Hello", voice: "zh-CN-XiaoxiaoNeural" },
        ac.signal,
      );

      const consumerPromise = (async () => {
        for await (const chunk of result.audio) {
          void chunk;
        }
      })();

      // Abort while waiting for stream data
      ac.abort();

      await expect(consumerPromise).rejects.toSatisfy((err: unknown) => {
        return err instanceof Error && err.name === "AbortError";
      });

      expect(streamDestroyed).toBe(true);
      expect(createdClient?.closeCallCount).toBe(1);
    });
  });

  describe("independent clients", () => {
    it("creates a new client instance for each synthesis call", async () => {
      const clientsCreated: FakeEdgeClient[] = [];
      const provider = new EdgeTtsProvider(() => {
        const client = new FakeEdgeClient();
        clientsCreated.push(client);
        return client;
      });

      const ac = new AbortController();
      await provider.synthesize({ text: "req1", voice: "zh-CN-XiaoxiaoNeural" }, ac.signal);
      await provider.synthesize({ text: "req2", voice: "zh-CN-XiaoxiaoNeural" }, ac.signal);

      expect(clientsCreated.length).toBe(2);
      expect(clientsCreated[0]).not.toBe(clientsCreated[1]);
    });
  });

  describe("input validation", () => {
    it("rejects empty or whitespace text", async () => {
      const provider = new EdgeTtsProvider(() => new FakeEdgeClient());
      const ac = new AbortController();

      await expect(
        provider.synthesize({ text: "", voice: "zh-CN-XiaoxiaoNeural" }, ac.signal),
      ).rejects.toThrow("Text must not be empty");

      await expect(
        provider.synthesize({ text: "   ", voice: "zh-CN-XiaoxiaoNeural" }, ac.signal),
      ).rejects.toThrow("Text must not be empty");
    });

    it("rejects empty or whitespace voice", async () => {
      const provider = new EdgeTtsProvider(() => new FakeEdgeClient());
      const ac = new AbortController();

      await expect(provider.synthesize({ text: "hello", voice: "" }, ac.signal)).rejects.toThrow(
        "Voice must not be empty",
      );

      await expect(provider.synthesize({ text: "hello", voice: "   " }, ac.signal)).rejects.toThrow(
        "Voice must not be empty",
      );
    });
  });

  describe("prosody integration in synthesis", () => {
    it("passes default prosody options to toStream when prosody is omitted", async () => {
      let createdClient: FakeEdgeClient | undefined;
      const provider = new EdgeTtsProvider(() => {
        createdClient = new FakeEdgeClient();
        return createdClient;
      });

      const ac = new AbortController();
      await provider.synthesize({ text: "hello", voice: "zh-CN-XiaoxiaoNeural" }, ac.signal);

      expect(createdClient?.toStreamCalls[0]?.options?.rate).toBe(1.0);
      expect(createdClient?.toStreamCalls[0]?.options?.pitch).toBe("+0st");
      expect(createdClient?.toStreamCalls[0]?.options?.volume).toBe(100.0);
    });

    it("passes custom prosody options to toStream", async () => {
      let createdClient: FakeEdgeClient | undefined;
      const provider = new EdgeTtsProvider(() => {
        createdClient = new FakeEdgeClient();
        return createdClient;
      });

      const ac = new AbortController();
      await provider.synthesize(
        {
          text: "hello",
          voice: "zh-CN-XiaoxiaoNeural",
          prosody: {
            speed: 1.25,
            pitchSemitones: 2,
            volume: 0.8,
          },
        },
        ac.signal,
      );

      expect(createdClient?.toStreamCalls[0]?.options?.rate).toBe(1.25);
      expect(createdClient?.toStreamCalls[0]?.options?.pitch).toBe("+2st");
      expect(createdClient?.toStreamCalls[0]?.options?.volume).toBe(80);
    });

    it("rejects invalid prosody without calling setMetadata or toStream", async () => {
      let createdClient: FakeEdgeClient | undefined;
      const provider = new EdgeTtsProvider(() => {
        createdClient = new FakeEdgeClient();
        return createdClient;
      });

      const ac = new AbortController();
      await expect(
        provider.synthesize(
          {
            text: "hello",
            voice: "zh-CN-XiaoxiaoNeural",
            prosody: { speed: 3.0 },
          },
          ac.signal,
        ),
      ).rejects.toThrowError(RangeError);

      expect(createdClient).toBeUndefined();
    });

    it("rejects invalid voice identifier with RangeError without creating client", async () => {
      let createdClient: FakeEdgeClient | undefined;
      const provider = new EdgeTtsProvider(() => {
        createdClient = new FakeEdgeClient();
        return createdClient;
      });

      const ac = new AbortController();
      const invalidVoices = [
        'zh-CN-XiaoxiaoNeural"><voice',
        "en-US-Jenny'sVoice",
        "voice with spaces",
        "voice/with/slashes",
        "voice;drop table",
        "a".repeat(129),
      ];

      for (const invalidVoice of invalidVoices) {
        await expect(
          provider.synthesize({ text: "hello", voice: invalidVoice }, ac.signal),
        ).rejects.toThrowError(RangeError);
      }

      expect(createdClient).toBeUndefined();
    });

    it("accepts valid voice identifiers", async () => {
      const provider = new EdgeTtsProvider(() => new FakeEdgeClient());
      const ac = new AbortController();

      const validVoices = [
        "zh-CN-XiaoxiaoNeural",
        "en-US-AvaMultilingualNeural",
        "a_b-1",
        "voice-123_ABC",
        "a".repeat(128),
      ];

      for (const voice of validVoices) {
        await expect(
          provider.synthesize({ text: "hello", voice }, ac.signal),
        ).resolves.toBeDefined();
      }
    });
  });

  describe("timeouts and aborts during handshake", () => {
    it("listVoices times out after configured timeout and closes client", async () => {
      let createdClient: FakeEdgeClient | undefined;
      const provider = new EdgeTtsProvider({
        clientFactory: () => {
          createdClient = new FakeEdgeClient();
          createdClient.getVoicesHandler = () => new Promise(() => {}); // never resolves
          return createdClient;
        },
        listVoicesTimeoutMs: 50,
      });

      await expect(provider.listVoices()).rejects.toThrow("Voice discovery timed out after 50ms");
      expect(createdClient?.closeCallCount).toBe(1);
    });

    it("closes again when aborted setMetadata resolves late", async () => {
      const setMetadata = createDeferred<void>();
      const client = new FakeEdgeClient();
      client.setMetadataHandler = () => setMetadata.promise;
      const provider = new EdgeTtsProvider({ clientFactory: () => client, setupTimeoutMs: 5000 });
      const ac = new AbortController();
      const synthesis = provider.synthesize(
        { text: "hello", voice: "zh-CN-XiaoxiaoNeural" },
        ac.signal,
      );

      ac.abort();

      await expect(synthesis).rejects.toSatisfy((err: unknown) => {
        return err instanceof Error && err.name === "AbortError";
      });
      expect(client.closeCallCount).toBe(1);

      setMetadata.resolve();
      await flushMicrotasks();

      expect(client.closeCallCount).toBe(2);
      expect(client.toStreamCalls).toHaveLength(0);
    });

    it("closes again when timed-out setMetadata resolves late", async () => {
      vi.useFakeTimers();
      try {
        const setMetadata = createDeferred<void>();
        const client = new FakeEdgeClient();
        client.setMetadataHandler = () => setMetadata.promise;
        const provider = new EdgeTtsProvider({ clientFactory: () => client, setupTimeoutMs: 10 });
        const synthesis = provider.synthesize(
          { text: "hello", voice: "zh-CN-XiaoxiaoNeural" },
          new AbortController().signal,
        );
        const synthesisAssertion = expect(synthesis).rejects.toThrow(
          "Speech synthesis setup timed out after 10ms",
        );

        await vi.advanceTimersByTimeAsync(10);

        await synthesisAssertion;
        expect(client.closeCallCount).toBe(1);

        setMetadata.resolve();
        await flushMicrotasks();

        expect(client.closeCallCount).toBe(2);
        expect(client.toStreamCalls).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it.each(["abort", "timeout"] as const)(
      "closes again without unhandled rejection when %s abandons setMetadata",
      async (abandonment) => {
        vi.useFakeTimers();
        try {
          const setMetadata = createDeferred<void>();
          const client = new FakeEdgeClient();
          client.setMetadataHandler = () => setMetadata.promise;
          const provider = new EdgeTtsProvider({
            clientFactory: () => client,
            setupTimeoutMs: 10,
          });
          const ac = new AbortController();
          const synthesis = provider.synthesize(
            { text: "hello", voice: "zh-CN-XiaoxiaoNeural" },
            ac.signal,
          );
          const synthesisAssertion = expect(synthesis).rejects.toThrow();

          if (abandonment === "abort") {
            ac.abort();
          } else {
            await vi.advanceTimersByTimeAsync(10);
          }

          await synthesisAssertion;
          expect(client.closeCallCount).toBe(1);

          setMetadata.reject(new Error("late setup failure"));
          await flushMicrotasks();

          expect(client.closeCallCount).toBe(2);
          expect(client.toStreamCalls).toHaveLength(0);
        } finally {
          vi.useRealTimers();
        }
      },
    );

    it("keeps an in-time setup connection usable until its stream completes", async () => {
      const setMetadata = createDeferred<void>();
      const client = new FakeEdgeClient(Readable.from([Buffer.from("data")]));
      client.setMetadataHandler = () => setMetadata.promise;
      const provider = new EdgeTtsProvider({ clientFactory: () => client, setupTimeoutMs: 5000 });
      const synthesis = provider.synthesize(
        { text: "hello", voice: "zh-CN-XiaoxiaoNeural" },
        new AbortController().signal,
      );

      setMetadata.resolve();
      const result = await synthesis;

      expect(client.toStreamCalls).toHaveLength(1);
      expect(client.closeCallCount).toBe(0);

      for await (const chunk of result.audio) {
        void chunk;
      }

      expect(client.closeCallCount).toBe(1);
    });
  });
});
