import { afterEach, expect, it, vi } from "vitest";
import { fetchHealth, fetchVoices, synthesizeSpeech } from "../src/api/client.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function pendingResponse() {
  let signal: AbortSignal;
  let body: ReadableStreamDefaultController<Uint8Array>;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      signal = init.signal!;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          body = controller;
        },
      });
      signal.addEventListener("abort", () => body.error(signal.reason), { once: true });
      return new Response(stream);
    }),
  );
  return {
    signal: () => signal,
    finish: (data: string) => {
      body.enqueue(new TextEncoder().encode(data));
      body.close();
    },
  };
}

it.each([fetchHealth, (signal: AbortSignal) => fetchVoices(undefined, signal)])(
  "keeps cancellation active while reading JSON",
  async (fetchJson) => {
    const response = pendingResponse();
    const caller = new AbortController();
    const pending = fetchJson(caller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    caller.abort();
    await rejected;
    expect(response.signal().aborted).toBe(true);
  },
);

it("times out a stalled JSON body and clears timers after a complete response", async () => {
  vi.useFakeTimers();
  pendingResponse();
  const rejected = expect(fetchHealth()).rejects.toMatchObject({ name: "TimeoutError" });
  await vi.advanceTimersByTimeAsync(10_000);
  await rejected;
  const response = pendingResponse();
  const healthy = fetchHealth();
  response.finish('{"status":"ok"}');
  expect(await healthy).toEqual({ status: "ok" });
  expect(vi.getTimerCount()).toBe(0);
});

it("allows long audio bodies and aborts Blob fallback downloads after headers", async () => {
  vi.useFakeTimers();
  const upstream = pendingResponse();
  const caller = new AbortController();
  const response = await synthesizeSpeech(
    { input: "test", voice: "en-US-AriaNeural" },
    caller.signal,
  );
  const rejected = expect(response.blob()).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(upstream.signal().aborted).toBe(false);
  caller.abort();
  await rejected;
  expect(upstream.signal().aborted).toBe(true);
});
