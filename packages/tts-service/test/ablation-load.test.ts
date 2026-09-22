import { expect, it } from "vitest";
import type { TtsProvider } from "@edgetts/tts-core";
import { VoiceCache } from "../src/voice-cache.js";
import { SynthesisLimiter } from "../src/synthesis-limiter.js";

it("serves 100 sequential warm voice reads with one upstream call", async () => {
  let upstreamCalls = 0;
  const provider: TtsProvider = {
    async listVoices() {
      upstreamCalls++;
      return [];
    },
    async synthesize() {
      throw new Error("unused");
    },
  };
  const cache = new VoiceCache(provider, { now: () => 1000 });
  for (let i = 0; i < 100; i++) await cache.getVoices();
  expect({ upstreamCalls }).toEqual({ upstreamCalls: 1 });
});

it("coalesces a 20-reader cold burst into one upstream call", async () => {
  let upstreamCalls = 0;
  const provider: TtsProvider = {
    async listVoices() {
      upstreamCalls++;
      return [];
    },
    async synthesize() {
      throw new Error("unused");
    },
  };
  const cache = new VoiceCache(provider);
  await Promise.all(Array.from({ length: 20 }, () => cache.getVoices()));
  expect({ upstreamCalls }).toEqual({ upstreamCalls: 1 });
});

it("serves 20 expired-cache reads during outage with one refresh attempt", async () => {
  let now = 0;
  let upstreamCalls = 0;
  let successfulReads = 0;
  const provider: TtsProvider = {
    async listVoices() {
      upstreamCalls++;
      if (now > 0) throw new Error("synthetic outage");
      return [];
    },
    async synthesize() {
      throw new Error("unused");
    },
  };
  const cache = new VoiceCache(provider, { now: () => now, ttlMs: 1000 });
  await cache.getVoices();
  now = 2000;
  for (let i = 0; i < 20; i++) {
    await cache.getVoices().then(
      () => {
        successfulReads++;
      },
      () => {},
    );
  }
  expect(successfulReads).toBe(20);
  expect({ refreshAttempts: upstreamCalls - 1, successfulReads }).toEqual({
    refreshAttempts: 1,
    successfulReads: 20,
  });
});

it("bounds a 24-request burst to four active and sixteen waiting permits", async () => {
  const limiter = new SynthesisLimiter({ maxConcurrent: 4, maxQueued: 16 });
  const controller = new AbortController();
  let rejected = 0;
  const requests = Array.from({ length: 24 }, () =>
    limiter.acquire(controller.signal).catch(() => {
      rejected++;
      return null;
    }),
  );
  // Flush promise reactions without depending on wall-clock timing.
  await Promise.resolve();
  const observed = { active: limiter.active, queued: limiter.queued, rejected };
  controller.abort();
  const permits = await Promise.all(requests);
  for (const permit of permits) permit?.release();
  expect(limiter.active).toBe(0);
  expect(limiter.queued).toBe(0);
  expect(observed.active).toBe(4);
  expect(observed).toEqual({ active: 4, queued: 16, rejected: 4 });
});
