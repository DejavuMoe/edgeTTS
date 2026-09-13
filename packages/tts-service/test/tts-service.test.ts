import { describe, it, expect } from "vitest";
import type { SynthesisRequest, SynthesisResult, TtsProvider, TtsVoice } from "@edgetts/tts-core";
import { SynthesisQueueFullError } from "../src/index.js";
import { TtsService } from "../src/tts-service.js";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function consumeStream(audio: AsyncIterable<Uint8Array>): Promise<number> {
  let bytes = 0;
  for await (const chunk of audio) {
    bytes += chunk.byteLength;
  }
  return bytes;
}

class FakeTtsProvider implements TtsProvider {
  public listVoicesCallCount = 0;
  public synthesizeCallCount = 0;
  public lastRequest?: SynthesisRequest | undefined;
  public lastSignal?: AbortSignal | undefined;

  public voicesResult: readonly TtsVoice[] = [
    {
      id: "zh-CN-XiaoxiaoNeural",
      displayName: "Xiaoxiao",
      locale: "zh-CN",
      gender: "Female",
    },
  ];

  public deferredVoices?: Deferred<readonly TtsVoice[]> | undefined;
  public voicesError?: Error | undefined;

  public synthesisResult: SynthesisResult = {
    format: "mp3-48k",
    contentType: "audio/mpeg",
    audio: (async function* () {
      yield new Uint8Array([1, 2, 3]);
    })(),
  };
  public synthesisError?: Error | undefined;
  public customSynthesize?:
    ((request: SynthesisRequest, signal: AbortSignal) => Promise<SynthesisResult>) | undefined;

  async listVoices(): Promise<readonly TtsVoice[]> {
    this.listVoicesCallCount++;
    if (this.voicesError) {
      throw this.voicesError;
    }
    if (this.deferredVoices) {
      return this.deferredVoices.promise;
    }
    return this.voicesResult;
  }

  async synthesize(request: SynthesisRequest, signal: AbortSignal): Promise<SynthesisResult> {
    this.synthesizeCallCount++;
    this.lastRequest = request;
    this.lastSignal = signal;
    if (this.customSynthesize) {
      return this.customSynthesize(request, signal);
    }
    if (this.synthesisError) {
      throw this.synthesisError;
    }
    return this.synthesisResult;
  }
}

describe("TtsService", () => {
  describe("TTL option validation", () => {
    it("rejects non-positive and non-finite TTL values with RangeError", () => {
      const provider = new FakeTtsProvider();
      expect(() => new TtsService(provider, { voiceCacheTtlMs: 0 })).toThrowError(RangeError);
      expect(() => new TtsService(provider, { voiceCacheTtlMs: -1000 })).toThrowError(RangeError);
      expect(() => new TtsService(provider, { voiceCacheTtlMs: NaN })).toThrowError(RangeError);
      expect(() => new TtsService(provider, { voiceCacheTtlMs: Infinity })).toThrowError(
        RangeError,
      );
      expect(() => new TtsService(provider, { voiceCacheTtlMs: -Infinity })).toThrowError(
        RangeError,
      );
    });

    it("accepts valid positive finite TTL", () => {
      const provider = new FakeTtsProvider();
      expect(() => new TtsService(provider, { voiceCacheTtlMs: 10_000 })).not.toThrow();
    });
  });

  describe("voice cache behavior", () => {
    it("fetches from provider on cold cache", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider);

      const voices = await service.listVoices();

      expect(provider.listVoicesCallCount).toBe(1);
      expect(voices).toEqual(provider.voicesResult);
    });

    it("serves from cache on fresh subsequent calls without hitting provider", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider);

      const first = await service.listVoices();
      const second = await service.listVoices();

      expect(provider.listVoicesCallCount).toBe(1);
      expect(first).toEqual(second);
    });

    it("expires cache exactly at age >= TTL", async () => {
      let currentTime = 1000;
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        voiceCacheTtlMs: 1000,
        now: () => currentTime,
      });

      // Initial load at t=1000
      await service.listVoices();
      expect(provider.listVoicesCallCount).toBe(1);

      // t=1999 (age=999 < 1000) -> hit
      currentTime = 1999;
      await service.listVoices();
      expect(provider.listVoicesCallCount).toBe(1);

      // t=2000 (age=1000 >= 1000) -> expired, refresh
      currentTime = 2000;
      await service.listVoices();
      expect(provider.listVoicesCallCount).toBe(2);
    });

    it("records cachedAt timestamp upon successful return, not fetch start", async () => {
      let currentTime = 1000;
      const deferred = createDeferred<readonly TtsVoice[]>();
      const provider = new FakeTtsProvider();
      provider.deferredVoices = deferred;

      const service = new TtsService(provider, {
        voiceCacheTtlMs: 1000,
        now: () => currentTime,
      });

      // Start fetch at t=1000
      const promise = service.listVoices();

      // Provider takes 4 seconds, completes at t=5000
      currentTime = 5000;
      deferred.resolve(provider.voicesResult);
      await promise;

      expect(provider.listVoicesCallCount).toBe(1);

      // Remove deferred for subsequent calls
      provider.deferredVoices = undefined;

      // At t=5999 (age=999 relative to t=5000), should still be cached
      currentTime = 5999;
      await service.listVoices();
      expect(provider.listVoicesCallCount).toBe(1);

      // At t=6000 (age=1000 relative to t=5000), expired
      currentTime = 6000;
      await service.listVoices();
      expect(provider.listVoicesCallCount).toBe(2);
    });

    it("forces refresh when forceRefresh is true even if cache is fresh", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider);

      const first = await service.listVoices();
      expect(first[0]?.id).toBe("zh-CN-XiaoxiaoNeural");
      expect(provider.listVoicesCallCount).toBe(1);

      // Provider changes returned voices
      provider.voicesResult = [
        {
          id: "zh-CN-YunxiNeural",
          displayName: "Yunxi",
          locale: "zh-CN",
          gender: "Male",
        },
      ];

      const refreshed = await service.listVoices({ forceRefresh: true });
      expect(refreshed[0]?.id).toBe("zh-CN-YunxiNeural");
      expect(provider.listVoicesCallCount).toBe(2);

      // Subsequent call receives refreshed cache
      const third = await service.listVoices();
      expect(third[0]?.id).toBe("zh-CN-YunxiNeural");
      expect(provider.listVoicesCallCount).toBe(2);
    });

    it("de-duplicates concurrent cold cache misses to a single provider call", async () => {
      const deferred = createDeferred<readonly TtsVoice[]>();
      const provider = new FakeTtsProvider();
      provider.deferredVoices = deferred;

      const service = new TtsService(provider);

      // Trigger 3 concurrent calls while fetch is in-flight
      const callA = service.listVoices();
      const callB = service.listVoices();
      const callC = service.listVoices();

      expect(provider.listVoicesCallCount).toBe(1);

      deferred.resolve(provider.voicesResult);

      const [resA, resB, resC] = await Promise.all([callA, callB, callC]);

      expect(provider.listVoicesCallCount).toBe(1);
      expect(resA).toEqual(provider.voicesResult);
      expect(resB).toEqual(provider.voicesResult);
      expect(resC).toEqual(provider.voicesResult);
    });

    it("joins existing in-flight fetch when forceRefresh is requested while fetch is in progress", async () => {
      const deferred = createDeferred<readonly TtsVoice[]>();
      const provider = new FakeTtsProvider();
      provider.deferredVoices = deferred;

      const service = new TtsService(provider);

      const callA = service.listVoices({ forceRefresh: true });
      const callB = service.listVoices();
      const callC = service.listVoices({ forceRefresh: true });

      expect(provider.listVoicesCallCount).toBe(1);

      deferred.resolve(provider.voicesResult);

      const [resA, resB, resC] = await Promise.all([callA, callB, callC]);

      expect(provider.listVoicesCallCount).toBe(1);
      expect(resA).toEqual(provider.voicesResult);
      expect(resB).toEqual(provider.voicesResult);
      expect(resC).toEqual(provider.voicesResult);
    });

    it("clears inFlight on provider failure so subsequent calls can retry", async () => {
      const provider = new FakeTtsProvider();
      provider.voicesError = new Error("Provider network down");

      const service = new TtsService(provider);

      await expect(service.listVoices()).rejects.toThrow("Provider network down");
      expect(provider.listVoicesCallCount).toBe(1);

      // Provider recovers
      provider.voicesError = undefined;

      const retryResult = await service.listVoices();
      expect(retryResult).toEqual(provider.voicesResult);
      expect(provider.listVoicesCallCount).toBe(2);
    });

    it("preserves existing valid cache when forceRefresh fails", async () => {
      let currentTime = 1000;
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        voiceCacheTtlMs: 5000,
        now: () => currentTime,
      });

      // Initial successful cache
      const initial = await service.listVoices();
      expect(provider.listVoicesCallCount).toBe(1);

      // Force refresh fails
      provider.voicesError = new Error("Refresh network error");
      currentTime = 2000;
      await expect(service.listVoices({ forceRefresh: true })).rejects.toThrow(
        "Refresh network error",
      );
      expect(provider.listVoicesCallCount).toBe(2);

      // Subsequent call within TTL still returns initial cache
      provider.voicesError = undefined;
      currentTime = 3000;
      const cached = await service.listVoices();
      expect(cached).toEqual(initial);
      expect(provider.listVoicesCallCount).toBe(2);
    });

    it("propagates error and does not return stale cache when expired cache refresh fails", async () => {
      let currentTime = 1000;
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        voiceCacheTtlMs: 1000,
        now: () => currentTime,
      });

      // Initial load at t=1000
      await service.listVoices();
      expect(provider.listVoicesCallCount).toBe(1);

      // Advance time past TTL (expired)
      currentTime = 2500;
      provider.voicesError = new Error("Upstream outage");

      await expect(service.listVoices()).rejects.toThrow("Upstream outage");
      expect(provider.listVoicesCallCount).toBe(2);
    });

    it("isolates internal cache from caller mutations and provider mutations", async () => {
      const rawVoice: TtsVoice = {
        id: "v1",
        displayName: "Initial Name",
        locale: "en-US",
        gender: "Female",
      };
      const provider = new FakeTtsProvider();
      provider.voicesResult = [rawVoice];

      const service = new TtsService(provider);

      const firstResult = await service.listVoices();
      expect(firstResult[0]?.displayName).toBe("Initial Name");

      // Caller attempts to mutate returned object
      const mutableFirst = firstResult as unknown as Array<{ displayName: string }>;
      if (mutableFirst[0]) {
        mutableFirst[0].displayName = "Caller Mutated";
      }

      // Provider mutates its array
      (rawVoice as { displayName: string }).displayName = "Provider Mutated";

      // Second call must return unaltered original cached snapshot
      const secondResult = await service.listVoices();
      expect(secondResult[0]?.displayName).toBe("Initial Name");
    });

    it("preserves provider voice ordering without sorting or filtering", async () => {
      const provider = new FakeTtsProvider();
      provider.voicesResult = [
        { id: "voice-C", displayName: "Charlie", locale: "en-US", gender: "Male" },
        { id: "voice-A", displayName: "Alice", locale: "zh-CN", gender: "Female" },
        { id: "voice-B", displayName: "Bob", locale: "ja-JP", gender: "Male" },
      ];

      const service = new TtsService(provider);
      const result = await service.listVoices();

      expect(result.map((v) => v.id)).toEqual(["voice-C", "voice-A", "voice-B"]);
    });
  });

  describe("synthesis delegation", () => {
    it("delegates to provider.synthesize without calling listVoices", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider);

      const request: SynthesisRequest = {
        text: "Delegation test",
        voice: "zh-CN-XiaoxiaoNeural",
        format: "mp3-48k",
        prosody: { speed: 1.25 },
      };
      const ac = new AbortController();

      const result = await service.synthesize(request, ac.signal);

      expect(provider.synthesizeCallCount).toBe(1);
      expect(provider.listVoicesCallCount).toBe(0);
      expect(provider.lastRequest).toEqual(request);
      expect(provider.lastSignal).toBe(ac.signal); // identical object reference
      expect(result.format).toBe(provider.synthesisResult.format);
      expect(result.contentType).toBe(provider.synthesisResult.contentType);
    });

    it("propagates synthesis error without swallowing or retrying", async () => {
      const provider = new FakeTtsProvider();
      const upstreamError = new Error("Upstream synthesis failed");
      provider.synthesisError = upstreamError;

      const service = new TtsService(provider);
      const ac = new AbortController();

      await expect(
        service.synthesize({ text: "test", voice: "zh-CN-XiaoxiaoNeural" }, ac.signal),
      ).rejects.toThrow("Upstream synthesis failed");

      expect(provider.synthesizeCallCount).toBe(1);
    });
  });

  describe("synthesis concurrency limiter and bounded FIFO queue", () => {
    describe("configuration validation", () => {
      it("rejects invalid maxConcurrentSyntheses values with RangeError", () => {
        const provider = new FakeTtsProvider();
        for (const invalid of [0, -1, 1.5, NaN, Infinity, -Infinity]) {
          expect(() => new TtsService(provider, { maxConcurrentSyntheses: invalid })).toThrowError(
            RangeError,
          );
        }
      });

      it("accepts valid positive integer maxConcurrentSyntheses values", () => {
        const provider = new FakeTtsProvider();
        for (const valid of [1, 4, 100]) {
          expect(() => new TtsService(provider, { maxConcurrentSyntheses: valid })).not.toThrow();
        }
      });

      it("rejects invalid maxQueuedSyntheses values with RangeError", () => {
        const provider = new FakeTtsProvider();
        for (const invalid of [-1, 1.5, NaN, Infinity, -Infinity]) {
          expect(() => new TtsService(provider, { maxQueuedSyntheses: invalid })).toThrowError(
            RangeError,
          );
        }
      });

      it("accepts valid non-negative integer maxQueuedSyntheses values", () => {
        const provider = new FakeTtsProvider();
        for (const valid of [0, 1, 16]) {
          expect(() => new TtsService(provider, { maxQueuedSyntheses: valid })).not.toThrow();
        }
      });
    });

    it("defaults to 4 active syntheses and queues the 5th", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider); // default 4 active, 16 queued
      const unblocks: Array<() => void> = [];

      provider.customSynthesize = async () => {
        const d = createDeferred<void>();
        unblocks.push(d.resolve);
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            await d.promise;
            yield new Uint8Array([1]);
          })(),
        };
      };

      const ac = new AbortController();
      const req = { text: "t", voice: "v" };

      // Launch 4 active syntheses
      const r1 = await service.synthesize(req, ac.signal);
      const r2 = await service.synthesize(req, ac.signal);
      const r3 = await service.synthesize(req, ac.signal);
      const r4 = await service.synthesize(req, ac.signal);
      expect(provider.synthesizeCallCount).toBe(4);

      // Start consuming slightly so they are active
      const it1 = r1.audio[Symbol.asyncIterator]();
      const p1 = it1.next();

      // Launch 5th: should be queued, provider not yet called for it
      let fifthCalled = false;
      const r5Promise = service.synthesize(req, ac.signal).then((res) => {
        fifthCalled = true;
        return res;
      });

      // Give microtasks a tick
      await new Promise((r) => setTimeout(r, 0));
      expect(provider.synthesizeCallCount).toBe(4);
      expect(fifthCalled).toBe(false);

      // Complete 1st stream
      unblocks[0]!();
      await p1;
      await it1.next(); // finish stream

      // Now 5th should acquire slot and call provider
      const r5 = await r5Promise;
      expect(provider.synthesizeCallCount).toBe(5);
      expect(fifthCalled).toBe(true);

      // Cleanup remaining
      for (const unblock of unblocks) {
        unblock();
      }
      await Promise.all([
        consumeStream(r2.audio),
        consumeStream(r3.audio),
        consumeStream(r4.audio),
        consumeStream(r5.audio),
      ]);
    });

    it("active slot covers entire stream lifetime, not just provider.synthesize resolution", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 5,
      });
      const streamDeferred = createDeferred<void>();

      provider.customSynthesize = async () => {
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            yield new Uint8Array([1, 2]);
            await streamDeferred.promise;
            yield new Uint8Array([3, 4]);
          })(),
        };
      };

      const ac = new AbortController();
      const resultA = await service.synthesize({ text: "A", voice: "v" }, ac.signal);
      expect(provider.synthesizeCallCount).toBe(1);

      // Call B while A's audio stream is NOT yet finished
      let bResolved = false;
      const bPromise = service.synthesize({ text: "B", voice: "v" }, ac.signal).then((res) => {
        bResolved = true;
        return res;
      });

      await new Promise((r) => setTimeout(r, 0));
      // CRITICAL: B's provider.synthesize must NOT have been called yet!
      expect(provider.synthesizeCallCount).toBe(1);
      expect(bResolved).toBe(false);

      // Consume A fully
      for await (const chunk of resultA.audio) {
        expect(chunk).toBeDefined();
        // reading chunk 1, then unblocking
        streamDeferred.resolve();
      }

      // Now B should have resolved
      await bPromise;
      expect(provider.synthesizeCallCount).toBe(2);
      expect(bResolved).toBe(true);
    });

    it("schedules queued requests in strict FIFO order", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 5,
      });
      const callOrder: string[] = [];

      provider.customSynthesize = async (req) => {
        callOrder.push(req.text);
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            yield new Uint8Array([1]);
          })(),
        };
      };

      const ac = new AbortController();
      const resA = await service.synthesize({ text: "A", voice: "v" }, ac.signal);

      // Queue B, C, D
      const pB = service.synthesize({ text: "B", voice: "v" }, ac.signal);
      const pC = service.synthesize({ text: "C", voice: "v" }, ac.signal);
      const pD = service.synthesize({ text: "D", voice: "v" }, ac.signal);

      expect(callOrder).toEqual(["A"]);

      // Finish A
      await consumeStream(resA.audio);
      const resB = await pB;
      expect(callOrder).toEqual(["A", "B"]);

      // Finish B
      await consumeStream(resB.audio);
      const resC = await pC;
      expect(callOrder).toEqual(["A", "B", "C"]);

      // Finish C
      await consumeStream(resC.audio);
      const resD = await pD;
      expect(callOrder).toEqual(["A", "B", "C", "D"]);

      await consumeStream(resD.audio);
    });

    it("rejects with SynthesisQueueFullError when queue capacity is exceeded", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 1,
      });
      const unblockA = createDeferred<void>();

      provider.customSynthesize = async () => {
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            await unblockA.promise;
            yield new Uint8Array([1]);
          })(),
        };
      };

      const ac = new AbortController();
      const resA = await service.synthesize({ text: "A", voice: "v" }, ac.signal);
      const itA = resA.audio[Symbol.asyncIterator]();
      const pA = itA.next();

      // B enters queue
      const pB = service.synthesize({ text: "B", voice: "v" }, ac.signal);

      // C exceeds queue
      await expect(service.synthesize({ text: "C", voice: "v" }, ac.signal)).rejects.toThrowError(
        SynthesisQueueFullError,
      );

      expect(provider.synthesizeCallCount).toBe(1);

      // Clean up A and B
      unblockA.resolve();
      await pA;
      await itA.next();
      const resB = await pB;
      await consumeStream(resB.audio);
    });

    it("rejects immediately with SynthesisQueueFullError when maxQueuedSyntheses is 0", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 0,
      });
      const unblockA = createDeferred<void>();

      provider.customSynthesize = async () => {
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            await unblockA.promise;
            yield new Uint8Array([1]);
          })(),
        };
      };

      const ac = new AbortController();
      const resA = await service.synthesize({ text: "A", voice: "v" }, ac.signal);
      const itA = resA.audio[Symbol.asyncIterator]();
      const pA = itA.next();

      await expect(service.synthesize({ text: "B", voice: "v" }, ac.signal)).rejects.toThrowError(
        SynthesisQueueFullError,
      );

      expect(provider.synthesizeCallCount).toBe(1);

      unblockA.resolve();
      await pA;
      await itA.next();
    });

    it("removes canceled queued requests and directly advances to next valid waiter", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 5,
      });
      const unblockA = createDeferred<void>();

      provider.customSynthesize = async (req) => {
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            if (req.text === "A") {
              await unblockA.promise;
            }
            yield new Uint8Array([1]);
          })(),
        };
      };

      const acA = new AbortController();
      const acB = new AbortController();
      const acC = new AbortController();

      const resA = await service.synthesize({ text: "A", voice: "v" }, acA.signal);
      const itA = resA.audio[Symbol.asyncIterator]();
      const pA = itA.next();

      const pB = service.synthesize({ text: "B", voice: "v" }, acB.signal);
      const pC = service.synthesize({ text: "C", voice: "v" }, acC.signal);

      // Cancel B while queued
      acB.abort();
      await expect(pB).rejects.toThrow();

      // Finish A
      unblockA.resolve();
      await pA;
      await itA.next();

      // C should be dispatched; B was never dispatched to provider
      const resC = await pC;
      expect(provider.lastRequest?.text).toBe("C");
      await consumeStream(resC.audio);
    });

    it("immediately rejects already aborted signal without calling provider or affecting capacity", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 1,
      });
      const ac = new AbortController();
      ac.abort();

      await expect(service.synthesize({ text: "test", voice: "v" }, ac.signal)).rejects.toThrow();
      expect(provider.synthesizeCallCount).toBe(0);

      // Still accepts valid calls
      const validAc = new AbortController();
      const result = await service.synthesize({ text: "valid", voice: "v" }, validAc.signal);
      expect(provider.synthesizeCallCount).toBe(1);
      await consumeStream(result.audio);
    });

    it("releases permit upon consumer early break", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 5,
      });

      provider.customSynthesize = async () => {
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            yield new Uint8Array([1]);
            yield new Uint8Array([2]);
            yield new Uint8Array([3]);
          })(),
        };
      };

      const ac = new AbortController();
      const resA = await service.synthesize({ text: "A", voice: "v" }, ac.signal);

      const pB = service.synthesize({ text: "B", voice: "v" }, ac.signal);

      // Consumer breaks early after reading 1 chunk
      for await (const chunk of resA.audio) {
        expect(chunk).toBeDefined();
        break;
      }

      const resB = await pB;
      expect(provider.lastRequest?.text).toBe("B");
      await consumeStream(resB.audio);
    });

    it("releases permit upon stream failure during iteration", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 5,
      });

      provider.customSynthesize = async (req) => {
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            if (req.text === "A") {
              yield new Uint8Array([1]);
              throw new Error("Stream exploded");
            }
            yield new Uint8Array([2]);
          })(),
        };
      };

      const ac = new AbortController();
      const resA = await service.synthesize({ text: "A", voice: "v" }, ac.signal);
      const pB = service.synthesize({ text: "B", voice: "v" }, ac.signal);

      await expect(consumeStream(resA.audio)).rejects.toThrow("Stream exploded");

      const resB = await pB;
      expect(provider.lastRequest?.text).toBe("B");
      await consumeStream(resB.audio);
    });

    it("releases permit upon provider pre-stream failure", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 5,
      });

      let callIndex = 0;
      provider.customSynthesize = async () => {
        callIndex++;
        if (callIndex === 1) {
          throw new Error("Provider pre-stream error");
        }
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            yield new Uint8Array([1]);
          })(),
        };
      };

      const ac = new AbortController();
      // First call fails at provider
      await expect(service.synthesize({ text: "A", voice: "v" }, ac.signal)).rejects.toThrow(
        "Provider pre-stream error",
      );

      // Second call must succeed because permit was released
      const resB = await service.synthesize({ text: "B", voice: "v" }, ac.signal);
      await consumeStream(resB.audio);
      expect(callIndex).toBe(2);
    });

    it("releases permit when active request is aborted mid-stream", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 5,
      });
      const blockedPromise = createDeferred<void>();

      provider.customSynthesize = async (req) => {
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            if (req.text === "A") {
              yield new Uint8Array([1]);
              await blockedPromise.promise;
              yield new Uint8Array([2]);
            } else {
              yield new Uint8Array([3]);
            }
          })(),
        };
      };

      const acA = new AbortController();
      const resA = await service.synthesize({ text: "A", voice: "v" }, acA.signal);
      const itA = resA.audio[Symbol.asyncIterator]();
      await itA.next(); // read chunk 1

      const pB = service.synthesize({ text: "B", voice: "v" }, new AbortController().signal);

      // Abort A
      acA.abort();

      const resB = await pB;
      expect(provider.lastRequest?.text).toBe("B");
      await consumeStream(resB.audio);
      blockedPromise.resolve();
    });

    it("releases permit when active request is aborted before consumer starts iteration", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 5,
      });

      provider.customSynthesize = async () => {
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            yield new Uint8Array([1]);
          })(),
        };
      };

      const acA = new AbortController();
      // Returns SynthesisResult, but consumer does NOT iterate resA.audio
      await service.synthesize({ text: "A", voice: "v" }, acA.signal);

      const pB = service.synthesize({ text: "B", voice: "v" }, new AbortController().signal);

      // Abort A before consumer iteration
      acA.abort();

      const resB = await pB;
      expect(provider.lastRequest?.text).toBe("B");
      await consumeStream(resB.audio);
    });

    it("prevents double release from causing over-allocation", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 5,
      });

      provider.customSynthesize = async () => {
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            yield new Uint8Array([1]);
          })(),
        };
      };

      const acA = new AbortController();
      const resA = await service.synthesize({ text: "A", voice: "v" }, acA.signal);

      // B and C queued
      const pB = service.synthesize({ text: "B", voice: "v" }, new AbortController().signal);
      let cResolved = false;
      void service.synthesize({ text: "C", voice: "v" }, new AbortController().signal).then(() => {
        cResolved = true;
      });

      // Consumer consumes A AND aborts A
      for await (const chunk of resA.audio) {
        expect(chunk).toBeDefined();
        acA.abort();
      }

      // Only B should be dispatched, C should remain queued
      await pB;
      await new Promise((r) => setTimeout(r, 0));
      expect(cResolved).toBe(false);
    });

    it("never exceeds configured maxConcurrentSyntheses limit under concurrency", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 2,
        maxQueuedSyntheses: 10,
      });

      let currentActive = 0;
      let maxActiveObserved = 0;
      const unblocks: Array<() => void> = [];
      let allowAll = false;

      provider.customSynthesize = async () => {
        currentActive++;
        if (currentActive > maxActiveObserved) {
          maxActiveObserved = currentActive;
        }
        const d = createDeferred<void>();
        if (allowAll) {
          d.resolve();
        } else {
          unblocks.push(d.resolve);
        }

        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            await d.promise;
            yield new Uint8Array([1]);
          })(),
        };
      };

      const ac = new AbortController();
      // Submit 6 requests
      const promises = [
        service.synthesize({ text: "1", voice: "v" }, ac.signal),
        service.synthesize({ text: "2", voice: "v" }, ac.signal),
        service.synthesize({ text: "3", voice: "v" }, ac.signal),
        service.synthesize({ text: "4", voice: "v" }, ac.signal),
        service.synthesize({ text: "5", voice: "v" }, ac.signal),
        service.synthesize({ text: "6", voice: "v" }, ac.signal),
      ];

      // Wait for first 2 to resolve
      const [res1, res2] = await Promise.all([promises[0]!, promises[1]!]);
      expect(maxActiveObserved).toBe(2);

      // Consume res1
      unblocks[0]!();
      for await (const chunk of res1.audio) {
        expect(chunk).toBeDefined();
        currentActive--;
      }

      // Now 3rd should resolve
      const res3 = await promises[2]!;
      expect(maxActiveObserved).toBe(2);

      // Finish remaining
      allowAll = true;
      for (const u of unblocks) {
        u();
      }
      for await (const chunk of res2.audio) {
        expect(chunk).toBeDefined();
        currentActive--;
      }
      for await (const chunk of res3.audio) {
        expect(chunk).toBeDefined();
        currentActive--;
      }
      // res4 and res5 resolve because res2 and res3 completed
      const [res4, res5] = await Promise.all([promises[3]!, promises[4]!]);
      expect(maxActiveObserved).toBeLessThanOrEqual(2);

      // Consuming res4 frees a slot for request 6
      for await (const chunk of res4.audio) {
        expect(chunk).toBeDefined();
        currentActive--;
      }

      // Now request 6 resolves
      const res6 = await promises[5]!;
      expect(maxActiveObserved).toBeLessThanOrEqual(2);

      for await (const chunk of res5.audio) {
        expect(chunk).toBeDefined();
        currentActive--;
      }
      for await (const chunk of res6.audio) {
        expect(chunk).toBeDefined();
        currentActive--;
      }

      expect(maxActiveObserved).toBeLessThanOrEqual(2);
    });

    it("recovers queue capacity when a queued request is canceled", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 1,
      });
      const unblockA = createDeferred<void>();

      provider.customSynthesize = async () => {
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            await unblockA.promise;
            yield new Uint8Array([1]);
          })(),
        };
      };

      const acA = new AbortController();
      const acB = new AbortController();
      const acC = new AbortController();

      const resA = await service.synthesize({ text: "A", voice: "v" }, acA.signal);
      const itA = resA.audio[Symbol.asyncIterator]();
      const pA = itA.next();

      // B is queued
      const pB = service.synthesize({ text: "B", voice: "v" }, acB.signal);

      // Now queue is full (1 queued). Aborting B frees the queue slot!
      acB.abort();
      await expect(pB).rejects.toThrow();

      // C should now successfully enter the queue instead of throwing SynthesisQueueFullError
      const pC = service.synthesize({ text: "C", voice: "v" }, acC.signal);

      unblockA.resolve();
      await pA;
      await itA.next();

      const resC = await pC;
      await consumeStream(resC.audio);
    });

    it("queue-full error on a new request does not affect existing queued requests", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 1,
      });
      const unblockA = createDeferred<void>();

      provider.customSynthesize = async () => {
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            await unblockA.promise;
            yield new Uint8Array([1]);
          })(),
        };
      };

      const ac = new AbortController();
      const resA = await service.synthesize({ text: "A", voice: "v" }, ac.signal);
      const itA = resA.audio[Symbol.asyncIterator]();
      const pA = itA.next();

      // B queued
      const pB = service.synthesize({ text: "B", voice: "v" }, ac.signal);

      // C rejected because queue is full
      await expect(service.synthesize({ text: "C", voice: "v" }, ac.signal)).rejects.toThrowError(
        SynthesisQueueFullError,
      );

      // Finish A -> B should complete normally
      unblockA.resolve();
      await pA;
      await itA.next();

      const resB = await pB;
      await consumeStream(resB.audio);
      expect(provider.synthesizeCallCount).toBe(2);
    });

    it("listVoices is completely unaffected by synthesis limiter saturation", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 0,
      });
      const unblockA = createDeferred<void>();

      provider.customSynthesize = async () => {
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            await unblockA.promise;
            yield new Uint8Array([1]);
          })(),
        };
      };

      const ac = new AbortController();
      const resA = await service.synthesize({ text: "A", voice: "v" }, ac.signal);
      const itA = resA.audio[Symbol.asyncIterator]();
      const pA = itA.next();

      // Synthesis capacity is totally full
      await expect(service.synthesize({ text: "B", voice: "v" }, ac.signal)).rejects.toThrowError(
        SynthesisQueueFullError,
      );

      // listVoices should still work seamlessly!
      const voices = await service.listVoices();
      expect(voices).toEqual(provider.voicesResult);

      unblockA.resolve();
      await pA;
      await itA.next();
    });
  });

  describe("synthesizeSegmented", () => {
    it("rejects invalid maxSegmentCodePoints with RangeError", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider);
      const ac = new AbortController();
      const request: SynthesisRequest = { text: "Hello", voice: "v" };

      await expect(
        service.synthesizeSegmented(
          request,
          ac.signal,
          null as unknown as { maxSegmentCodePoints: number },
        ),
      ).rejects.toThrowError(RangeError);

      await expect(
        service.synthesizeSegmented(request, ac.signal, { maxSegmentCodePoints: 0 }),
      ).rejects.toThrowError(RangeError);

      await expect(
        service.synthesizeSegmented(request, ac.signal, { maxSegmentCodePoints: -10 }),
      ).rejects.toThrowError(RangeError);

      await expect(
        service.synthesizeSegmented(request, ac.signal, { maxSegmentCodePoints: 1.5 }),
      ).rejects.toThrowError(RangeError);

      await expect(
        service.synthesizeSegmented(request, ac.signal, { maxSegmentCodePoints: NaN }),
      ).rejects.toThrowError(RangeError);

      await expect(
        service.synthesizeSegmented(request, ac.signal, { maxSegmentCodePoints: Infinity }),
      ).rejects.toThrowError(RangeError);
    });

    it("synthesizes short text in a single call", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider);
      const ac = new AbortController();

      const result = await service.synthesizeSegmented(
        { text: "Short text", voice: "v" },
        ac.signal,
        { maxSegmentCodePoints: 50 },
      );

      expect(result.format).toBe("mp3-48k");
      expect(result.contentType).toBe("audio/mpeg");
      expect(provider.synthesizeCallCount).toBe(1);
      expect(provider.lastRequest?.text).toBe("Short text");

      const bytes = await consumeStream(result.audio);
      expect(bytes).toBe(3);
      expect(provider.synthesizeCallCount).toBe(1);
    });

    it("synthesizes long text into exact expected segments in order", async () => {
      const provider = new FakeTtsProvider();
      const recordedTexts: string[] = [];

      provider.customSynthesize = async (req) => {
        recordedTexts.push(req.text);
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            yield new Uint8Array([req.text.length]);
          })(),
        };
      };

      const service = new TtsService(provider);
      const text = "First sentence.\n\nSecond paragraph.\n\nThird paragraph.";
      const ac = new AbortController();

      const result = await service.synthesizeSegmented({ text, voice: "test-voice" }, ac.signal, {
        maxSegmentCodePoints: 20,
      });

      const chunks: number[] = [];
      for await (const chunk of result.audio) {
        chunks.push(...chunk);
      }

      expect(recordedTexts.length).toBeGreaterThanOrEqual(3);
      expect(recordedTexts.join("")).toBe(text);
      expect(chunks.length).toBe(recordedTexts.length);
    });

    it("preserves request metadata (voice, format, prosody) for every segment", async () => {
      const provider = new FakeTtsProvider();
      const recordedRequests: SynthesisRequest[] = [];

      provider.customSynthesize = async (req) => {
        recordedRequests.push(req);
        return {
          format: "mp3-96k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            yield new Uint8Array([1]);
          })(),
        };
      };

      const service = new TtsService(provider);
      const ac = new AbortController();
      const originalRequest: SynthesisRequest = {
        text: "Part 1. Part 2. Part 3.",
        voice: "custom-voice",
        format: "mp3-96k",
        prosody: {
          speed: 1.5,
          pitchSemitones: -2,
          volume: 0.8,
        },
      };

      const result = await service.synthesizeSegmented(originalRequest, ac.signal, {
        maxSegmentCodePoints: 10,
      });

      await consumeStream(result.audio);

      expect(recordedRequests.length).toBeGreaterThanOrEqual(2);
      for (const req of recordedRequests) {
        expect(req.voice).toBe("custom-voice");
        expect(req.format).toBe("mp3-96k");
        expect(req.prosody).toEqual({
          speed: 1.5,
          pitchSemitones: -2,
          volume: 0.8,
        });
      }
    });

    it("emits first audio chunk before second segment synthesis begins", async () => {
      const provider = new FakeTtsProvider();
      const secondCallStarted = createDeferred<void>();
      let segment2Called = false;

      provider.customSynthesize = async (req) => {
        if (req.text.includes("First")) {
          return {
            format: "mp3-48k",
            contentType: "audio/mpeg",
            audio: (async function* () {
              yield new Uint8Array([42]);
            })(),
          };
        }
        segment2Called = true;
        secondCallStarted.resolve();
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            yield new Uint8Array([99]);
          })(),
        };
      };

      const service = new TtsService(provider);
      const ac = new AbortController();
      const result = await service.synthesizeSegmented(
        { text: "First segment.\n\nSecond segment.", voice: "v" },
        ac.signal,
        { maxSegmentCodePoints: 16 },
      );

      const iterator = result.audio[Symbol.asyncIterator]();
      const firstChunkResult = await iterator.next();

      // Chunk 1 was received!
      expect(firstChunkResult.value).toEqual(new Uint8Array([42]));
      // Segment 2 must NOT have been called yet because chunk 1 is emitted before segment 1 completes!
      expect(segment2Called).toBe(false);

      // Now reading next chunk triggers segment 2
      const secondChunkResult = await iterator.next();
      expect(segment2Called).toBe(true);
      expect(secondChunkResult.value).toEqual(new Uint8Array([99]));
    });

    it("executes provider synthesis calls strictly sequentially", async () => {
      const provider = new FakeTtsProvider();
      let activeCalls = 0;
      let maxActiveCalls = 0;

      provider.customSynthesize = async (req) => {
        activeCalls++;
        if (activeCalls > maxActiveCalls) {
          maxActiveCalls = activeCalls;
        }
        await new Promise((r) => setTimeout(r, 10));
        activeCalls--;
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            yield new Uint8Array([req.text.length]);
          })(),
        };
      };

      const service = new TtsService(provider);
      const ac = new AbortController();
      const result = await service.synthesizeSegmented(
        { text: "One.\n\nTwo.\n\nThree.", voice: "v" },
        ac.signal,
        { maxSegmentCodePoints: 6 },
      );

      await consumeStream(result.audio);
      expect(maxActiveCalls).toBe(1);
    });

    it("yields all audio chunks from all segments in order without buffering entire stream", async () => {
      const provider = new FakeTtsProvider();
      provider.customSynthesize = async (req) => {
        const id = req.text.includes("First") ? 1 : req.text.includes("Second") ? 2 : 3;
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            yield new Uint8Array([id, 1]);
            yield new Uint8Array([id, 2]);
          })(),
        };
      };

      const service = new TtsService(provider);
      const ac = new AbortController();
      const result = await service.synthesizeSegmented(
        { text: "First part.\n\nSecond part.\n\nThird part.", voice: "v" },
        ac.signal,
        { maxSegmentCodePoints: 14 },
      );

      const allChunks: number[] = [];
      for await (const chunk of result.audio) {
        allChunks.push(...chunk);
      }

      expect(allChunks).toEqual([1, 1, 1, 2, 2, 1, 2, 2, 3, 1, 3, 2]);
    });

    it("propagates pre-stream failure in later segment and stops subsequent segments", async () => {
      const provider = new FakeTtsProvider();
      let segmentCount = 0;

      provider.customSynthesize = async (req) => {
        segmentCount++;
        if (req.text.includes("Second")) {
          throw new Error("Provider explosion on segment 2");
        }
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            yield new Uint8Array([1]);
          })(),
        };
      };

      const service = new TtsService(provider);
      const ac = new AbortController();
      const result = await service.synthesizeSegmented(
        { text: "First part.\n\nSecond part.\n\nThird part.", voice: "v" },
        ac.signal,
        { maxSegmentCodePoints: 14 },
      );

      const iterator = result.audio[Symbol.asyncIterator]();
      const firstChunk = await iterator.next();
      expect(firstChunk.value).toEqual(new Uint8Array([1]));

      await expect(iterator.next()).rejects.toThrowError("Provider explosion on segment 2");
      expect(segmentCount).toBe(2);
    });

    it("propagates stream failure in later segment and stops subsequent segments", async () => {
      const provider = new FakeTtsProvider();
      let segmentCount = 0;

      provider.customSynthesize = async (req) => {
        segmentCount++;
        if (req.text.includes("Second")) {
          return {
            format: "mp3-48k",
            contentType: "audio/mpeg",
            audio: (async function* () {
              yield new Uint8Array([2]);
              throw new Error("Mid-stream explosion");
            })(),
          };
        }
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            yield new Uint8Array([1]);
          })(),
        };
      };

      const service = new TtsService(provider);
      const ac = new AbortController();
      const result = await service.synthesizeSegmented(
        { text: "First part.\n\nSecond part.\n\nThird part.", voice: "v" },
        ac.signal,
        { maxSegmentCodePoints: 14 },
      );

      const received: number[] = [];
      const iterator = result.audio[Symbol.asyncIterator]();
      const c1 = await iterator.next();
      received.push(...c1.value!);
      const c2 = await iterator.next();
      received.push(...c2.value!);

      await expect(iterator.next()).rejects.toThrowError("Mid-stream explosion");
      expect(received).toEqual([1, 2]);
      expect(segmentCount).toBe(2);
    });

    it("aborts between segments and prevents later segment synthesis", async () => {
      const provider = new FakeTtsProvider();
      let segmentCount = 0;

      provider.customSynthesize = async () => {
        segmentCount++;
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            yield new Uint8Array([1]);
          })(),
        };
      };

      const service = new TtsService(provider);
      const ac = new AbortController();
      const result = await service.synthesizeSegmented(
        { text: "First part.\n\nSecond part.\n\nThird part.", voice: "v" },
        ac.signal,
        { maxSegmentCodePoints: 14 },
      );

      const iterator = result.audio[Symbol.asyncIterator]();
      await iterator.next(); // read chunk from segment 1

      // Abort between segments
      ac.abort();

      await expect(iterator.next()).rejects.toThrowError();
      expect(segmentCount).toBe(1);
    });

    it("stops subsequent synthesis when consumer breaks early", async () => {
      const provider = new FakeTtsProvider();
      let callCount = 0;

      provider.customSynthesize = async () => {
        callCount++;
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            yield new Uint8Array([1]);
          })(),
        };
      };

      const service = new TtsService(provider);
      const ac = new AbortController();
      const result = await service.synthesizeSegmented(
        { text: "Part 1.\n\nPart 2.\n\nPart 3.\n\nPart 4.", voice: "v" },
        ac.signal,
        { maxSegmentCodePoints: 8 },
      );

      for await (const chunk of result.audio) {
        expect(chunk).toEqual(new Uint8Array([1]));
        break; // consumer early exit
      }

      expect(callCount).toBe(1);
    });

    it("allows queued normal request to run between segmented chunks (fairness)", async () => {
      const provider = new FakeTtsProvider();
      const callLog: string[] = [];
      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 5,
      });

      const segment1Yielded = createDeferred<void>();
      const segment1Done = createDeferred<void>();

      provider.customSynthesize = async (req) => {
        callLog.push(`start:${req.text}`);
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            if (req.text.includes("Seg1")) {
              segment1Yielded.resolve();
              yield new Uint8Array([1]);
              await segment1Done.promise;
            } else if (req.text === "Normal") {
              yield new Uint8Array([2]);
            } else {
              yield new Uint8Array([3]);
            }
          })(),
        };
      };

      const ac = new AbortController();
      const segResult = await service.synthesizeSegmented(
        { text: "Seg1.\n\nSeg2.", voice: "v" },
        ac.signal,
        { maxSegmentCodePoints: 7 },
      );

      const segIterator = segResult.audio[Symbol.asyncIterator]();
      const firstChunkPromise = segIterator.next();

      // Wait until segment 1 yields chunk
      await segment1Yielded.promise;

      // While segment 1 is still holding the permit, queue a normal request
      const normalPromise = service.synthesize({ text: "Normal", voice: "v" }, ac.signal);

      // Now complete segment 1 audio consumption
      segment1Done.resolve();
      await firstChunkPromise;

      // Request next chunk from segIterator, which exhausts segment 1 (releasing its permit)
      // and queues segment 2 for a permit.
      // Because normalPromise was queued while segment 1 was active,
      // the limiter schedules normalPromise ahead of segment 2 (FIFO queue fairness).
      const secondChunkPromise = segIterator.next();

      // Normal request now acquires the permit, synthesizes, and streams to completion.
      const normalResult = await normalPromise;
      await consumeStream(normalResult.audio);

      // Once normal request finishes and releases permit, segment 2 acquires permit and yields.
      const secondChunk = await secondChunkPromise;
      expect(secondChunk.value).toEqual(new Uint8Array([3]));

      // Verify execution order: Seg1 started, then Normal started, then Seg2 started
      expect(callLog).toEqual(["start:Seg1.\n\n", "start:Normal", "start:Seg2."]);
    });

    it("rejects if a subsequent segment returns an inconsistent format or contentType", async () => {
      const provider = new FakeTtsProvider();
      let callCount = 0;

      provider.customSynthesize = async () => {
        callCount++;
        if (callCount === 1) {
          return {
            format: "mp3-48k",
            contentType: "audio/mpeg",
            audio: (async function* () {
              yield new Uint8Array([1]);
            })(),
          };
        }
        return {
          format: "mp3-96k", // Inconsistent format!
          contentType: "audio/mpeg",
          audio: (async function* () {
            yield new Uint8Array([2]);
          })(),
        };
      };

      const service = new TtsService(provider);
      const ac = new AbortController();
      const result = await service.synthesizeSegmented(
        { text: "Part 1.\n\nPart 2.", voice: "v" },
        ac.signal,
        { maxSegmentCodePoints: 8 },
      );

      const iterator = result.audio[Symbol.asyncIterator]();
      await iterator.next(); // first segment succeeds

      await expect(iterator.next()).rejects.toThrowError(/inconsistent audio metadata/);
    });

    it("immediately rejects already aborted signal before starting synthesis", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider);
      const ac = new AbortController();
      ac.abort();

      await expect(
        service.synthesizeSegmented({ text: "Hello", voice: "v" }, ac.signal, {
          maxSegmentCodePoints: 10,
        }),
      ).rejects.toThrowError();

      expect(provider.synthesizeCallCount).toBe(0);
    });
  });

  describe("Phase 13.1 Streaming Lifecycle Hardening", () => {
    it("releases permit when iterator.return() is called before first next()", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 1,
      });

      const acA = new AbortController();
      const resA = await service.synthesize({ text: "A", voice: "v" }, acA.signal);
      const iterA = resA.audio[Symbol.asyncIterator]();
      await iterA.return?.();

      // Request B must be able to acquire permit and complete immediately
      const acB = new AbortController();
      const resB = await service.synthesize({ text: "B", voice: "v" }, acB.signal);
      expect(resB).toBeDefined();
      await consumeStream(resB.audio);
    });

    it("releases permit when iterator.throw() is called", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 1,
      });

      const acA = new AbortController();
      const resA = await service.synthesize({ text: "A", voice: "v" }, acA.signal);
      const iterA = resA.audio[Symbol.asyncIterator]();
      await expect(iterA.throw?.(new Error("custom stream failure"))).rejects.toThrow(
        "custom stream failure",
      );

      // Request B must acquire permit and complete immediately
      const acB = new AbortController();
      const resB = await service.synthesize({ text: "B", voice: "v" }, acB.signal);
      expect(resB).toBeDefined();
      await consumeStream(resB.audio);
    });

    it("enforces single-consumer stream contract (audio[Symbol.asyncIterator]() === audio)", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider);
      const res = await service.synthesize(
        { text: "test", voice: "v" },
        new AbortController().signal,
      );
      expect(res.audio[Symbol.asyncIterator]()).toBe(res.audio);
    });

    it("releases permit exactly once and does not over-allocate when return and abort coincide", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 5,
      });

      const acA = new AbortController();
      const resA = await service.synthesize({ text: "A", voice: "v" }, acA.signal);
      const iterA = resA.audio[Symbol.asyncIterator]();

      // Trigger both return and abort
      await iterA.return?.();
      acA.abort();

      let bStarted = false;
      let cStarted = false;
      const pB = service
        .synthesize({ text: "B", voice: "v" }, new AbortController().signal)
        .then(() => {
          bStarted = true;
        });
      void service.synthesize({ text: "C", voice: "v" }, new AbortController().signal).then(() => {
        cStarted = true;
      });

      await pB;
      expect(bStarted).toBe(true);
      // C must NOT have started because capacity is 1 and B holds the active slot
      expect(cStarted).toBe(false);
    });

    it("segmented metadata mismatch releases segment permit and allows subsequent requests", async () => {
      let callCount = 0;
      const provider = new FakeTtsProvider();
      provider.customSynthesize = async () => {
        callCount++;
        return {
          format: callCount === 1 ? "mp3-48k" : "mp3-96k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            yield new Uint8Array([1, 2]);
          })(),
        };
      };

      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 2,
      });

      const acSeg = new AbortController();
      const resSeg = await service.synthesizeSegmented(
        { text: "P1\n\nP2", voice: "v" },
        acSeg.signal,
        { maxSegmentCodePoints: 4 },
      );

      const iterSeg = resSeg.audio[Symbol.asyncIterator]();
      await iterSeg.next(); // segment 1 succeeds
      await expect(iterSeg.next()).rejects.toThrowError(/inconsistent audio metadata/);

      // Request C must immediately obtain the released permit!
      const acC = new AbortController();
      const resC = await service.synthesize({ text: "C", voice: "v" }, acC.signal);
      expect(resC).toBeDefined();
      await consumeStream(resC.audio);
    });

    it("segmented outer return-before-first-next releases first segment permit and allows subsequent requests", async () => {
      const provider = new FakeTtsProvider();
      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 2,
      });

      const acSeg = new AbortController();
      const resSeg = await service.synthesizeSegmented(
        { text: "P1\n\nP2", voice: "v" },
        acSeg.signal,
        { maxSegmentCodePoints: 4 },
      );

      const iterSeg = resSeg.audio[Symbol.asyncIterator]();
      // Return outer iterator BEFORE calling next()
      await iterSeg.return?.();

      // Subsequent request B must obtain permit and succeed!
      const acB = new AbortController();
      const resB = await service.synthesize({ text: "B", voice: "v" }, acB.signal);
      expect(resB).toBeDefined();
      await consumeStream(resB.audio);
    });

    it("segmented consumer early break releases permit and prevents further segment synthesis", async () => {
      const synthesizedSegments: string[] = [];
      const provider = new FakeTtsProvider();
      provider.customSynthesize = async (req) => {
        synthesizedSegments.push(req.text);
        return {
          format: "mp3-48k",
          contentType: "audio/mpeg",
          audio: (async function* () {
            yield new Uint8Array([1, 2]);
            yield new Uint8Array([3, 4]);
          })(),
        };
      };

      const service = new TtsService(provider, {
        maxConcurrentSyntheses: 1,
        maxQueuedSyntheses: 2,
      });

      const acSeg = new AbortController();
      const resSeg = await service.synthesizeSegmented(
        { text: "Part 1\n\nPart 2\n\nPart 3", voice: "v" },
        acSeg.signal,
        { maxSegmentCodePoints: 8 },
      );

      for await (const chunk of resSeg.audio) {
        expect(chunk).toBeDefined();
        break; // break on first chunk
      }

      // Subsequent segments must NOT have been synthesized
      expect(synthesizedSegments).toHaveLength(1);

      // Subsequent request B must succeed immediately
      const resB = await service.synthesize(
        { text: "B", voice: "v" },
        new AbortController().signal,
      );
      expect(resB).toBeDefined();
      await consumeStream(resB.audio);
    });
  });
});
