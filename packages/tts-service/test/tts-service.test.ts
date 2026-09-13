import { describe, it, expect } from "vitest";
import type { SynthesisRequest, SynthesisResult, TtsProvider, TtsVoice } from "@edgetts/tts-core";
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
      expect(result).toBe(provider.synthesisResult);
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
});
