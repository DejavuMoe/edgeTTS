import { describe, expect, it } from "vitest";
import type { TtsProvider, TtsVoice } from "@edgetts/tts-core";
import {
  DEFAULT_VOICE_CACHE_ERROR_BACKOFF_MS,
  DEFAULT_VOICE_CACHE_TTL_MS,
  VoiceCache,
} from "../src/voice-cache.js";

class MockProvider implements TtsProvider {
  public listVoicesCallCount = 0;
  public voicesToReturn: readonly TtsVoice[] = [
    {
      id: "zh-CN-XiaoxiaoNeural",
      displayName: "Xiaoxiao",
      locale: "zh-CN",
      gender: "Female",
    },
  ];
  public listVoicesError: Error | null = null;
  public listVoicesDelayMs = 0;

  async listVoices(): Promise<readonly TtsVoice[]> {
    this.listVoicesCallCount++;
    if (this.listVoicesDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.listVoicesDelayMs));
    }
    if (this.listVoicesError) {
      throw this.listVoicesError;
    }
    return this.voicesToReturn;
  }

  async synthesize(): Promise<never> {
    throw new Error("Not implemented in MockProvider");
  }
}

describe("VoiceCache", () => {
  it("validates constructor options and exports defaults", () => {
    expect(DEFAULT_VOICE_CACHE_TTL_MS).toBe(6 * 60 * 60 * 1000);
    expect(DEFAULT_VOICE_CACHE_ERROR_BACKOFF_MS).toBe(5000);

    const provider = new MockProvider();

    expect(() => new VoiceCache(provider, { ttlMs: 0 })).toThrowError(RangeError);
    expect(() => new VoiceCache(provider, { ttlMs: -100 })).toThrowError(RangeError);
    expect(() => new VoiceCache(provider, { ttlMs: NaN })).toThrowError(RangeError);
    expect(() => new VoiceCache(provider, { errorBackoffMs: -1 })).toThrowError(RangeError);
    expect(() => new VoiceCache(provider, { errorBackoffMs: NaN })).toThrowError(RangeError);
  });

  it("fetches and caches voices when cold", async () => {
    const provider = new MockProvider();
    const cache = new VoiceCache(provider);

    const voices = await cache.getVoices();
    expect(voices).toHaveLength(1);
    expect(voices[0]?.id).toBe("zh-CN-XiaoxiaoNeural");
    expect(provider.listVoicesCallCount).toBe(1);

    // Second call within default TTL returns cached voices without provider call
    const cached = await cache.getVoices();
    expect(cached).toEqual(voices);
    expect(provider.listVoicesCallCount).toBe(1);
  });

  it("rethrows error when cold and upstream fails, allowing retry", async () => {
    const provider = new MockProvider();
    provider.listVoicesError = new Error("Network down");
    const cache = new VoiceCache(provider);

    await expect(cache.getVoices()).rejects.toThrow("Network down");
    expect(provider.listVoicesCallCount).toBe(1);

    // In-flight must be cleared, allowing retry
    provider.listVoicesError = null;
    const voices = await cache.getVoices();
    expect(voices).toHaveLength(1);
    expect(provider.listVoicesCallCount).toBe(2);
  });

  it("falls back to stale cached voices on expired refresh failure and enforces backoff (SEC-03)", async () => {
    let now = 1000;
    const provider = new MockProvider();
    const cache = new VoiceCache(provider, {
      ttlMs: 5000,
      errorBackoffMs: 2000,
      now: () => now,
    });

    // Initial load at t=1000
    const initial = await cache.getVoices();
    expect(provider.listVoicesCallCount).toBe(1);

    // Advance to t=7000 (expired, age = 6000 > 5000)
    now = 7000;
    provider.listVoicesError = new Error("DNS resolution failed");

    // Must return stale cached voices instead of throwing
    const stale = await cache.getVoices();
    expect(stale).toEqual(initial);
    expect(provider.listVoicesCallCount).toBe(2);

    // Consecutive call at t=8000 (within errorBackoffMs 2000, age since error = 1000)
    // Must return stale voices WITHOUT calling provider (request storm prevention!)
    now = 8000;
    const backedOff = await cache.getVoices();
    expect(backedOff).toEqual(initial);
    expect(provider.listVoicesCallCount).toBe(2);

    // Advance past backoff window to t=9500 (age since error = 2500 > 2000)
    now = 9500;
    provider.listVoicesError = null;
    provider.voicesToReturn = [
      {
        id: "en-US-JennyNeural",
        displayName: "Jenny",
        locale: "en-US",
        gender: "Female",
      },
    ];

    const refreshed = await cache.getVoices();
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]?.id).toBe("en-US-JennyNeural");
    expect(provider.listVoicesCallCount).toBe(3);
  });

  it("coalesces concurrent requests into a single in-flight fetch", async () => {
    const provider = new MockProvider();
    provider.listVoicesDelayMs = 20;
    const cache = new VoiceCache(provider);

    const [v1, v2, v3] = await Promise.all([
      cache.getVoices(),
      cache.getVoices(),
      cache.getVoices(),
    ]);

    expect(provider.listVoicesCallCount).toBe(1);
    expect(v1).toEqual(v2);
    expect(v2).toEqual(v3);
  });

  it("throws on forceRefresh if upstream fails", async () => {
    const now = 1000;
    const provider = new MockProvider();
    const cache = new VoiceCache(provider, {
      ttlMs: 10000,
      now: () => now,
    });

    const initial = await cache.getVoices();
    expect(provider.listVoicesCallCount).toBe(1);

    provider.listVoicesError = new Error("Force refresh failed");
    await expect(cache.getVoices(true)).rejects.toThrow("Force refresh failed");
    expect(provider.listVoicesCallCount).toBe(2);

    // Cache remains populated with original snapshot
    const cached = await cache.getVoices();
    expect(cached).toEqual(initial);
    expect(provider.listVoicesCallCount).toBe(2);
  });

  it("returns isolated copies to prevent caller mutations from affecting cache", async () => {
    const provider = new MockProvider();
    const cache = new VoiceCache(provider);

    const first = await cache.getVoices();
    (first[0] as unknown as { displayName: string }).displayName = "MUTATED";

    const second = await cache.getVoices();
    expect(second[0]?.displayName).toBe("Xiaoxiao");
  });
});
