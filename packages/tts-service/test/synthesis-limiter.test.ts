import { afterEach, expect, it, vi } from "vitest";
import { SynthesisLimiter, SynthesisQueueFullError } from "../src/synthesis-limiter.js";

afterEach(() => vi.useRealTimers());

it("expires queued requests without releasing active permits and admits the next FIFO waiter", async () => {
  vi.useFakeTimers();
  const limiter = new SynthesisLimiter({ maxConcurrent: 1, maxQueued: 2 });
  const signal = new AbortController().signal;
  const active = await limiter.acquire(signal);
  const expired = expect(limiter.acquire(signal)).rejects.toBeInstanceOf(SynthesisQueueFullError);
  await vi.advanceTimersByTimeAsync(20_000);
  const next = limiter.acquire(signal);
  await vi.advanceTimersByTimeAsync(10_000);
  await expired;
  expect(limiter.active).toBe(1);
  expect(limiter.queued).toBe(1);
  active.release();
  const permit = await next;
  expect(limiter.queued).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  permit.release();
  expect(limiter.active).toBe(0);
});

it("removes queue timers on cancellation and does not expire an admitted stream", async () => {
  vi.useFakeTimers();
  const limiter = new SynthesisLimiter({ maxConcurrent: 1, maxQueued: 1 });
  const active = await limiter.acquire(new AbortController().signal);
  const caller = new AbortController();
  const aborted = expect(limiter.acquire(caller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  caller.abort();
  await aborted;
  expect(limiter.queued).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(limiter.active).toBe(1);
  active.release();
});
