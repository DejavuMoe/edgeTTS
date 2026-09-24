import { afterEach, describe, expect, it, vi } from "vitest";
import type { SynthesisRequest, SynthesisResult, TtsProvider, TtsVoice } from "@edgetts/tts-core";
import { TtsService } from "../src/index.js";

const CATALOG: readonly TtsVoice[] = [
  { id: "zh-CN-XiaoxiaoNeural", displayName: "Xiaoxiao", locale: "zh-CN", gender: "Female" },
  { id: "en-US-JennyNeural", displayName: "Jenny", locale: "en-US", gender: "Female" },
];

const provider: TtsProvider = {
  listVoices: () => Promise.resolve(CATALOG),
  synthesize: (request: SynthesisRequest): Promise<SynthesisResult> =>
    Promise.resolve({
      format: request.format ?? "mp3-48k",
      contentType: "audio/mpeg",
      audio: (async function* () {
        yield new Uint8Array([1]);
      })(),
    }),
};

const SEGMENTED = { maxSegmentCodePoints: 300 };
const REQUEST = { text: "hello", voice: "zh-CN-XiaoxiaoNeural" };

afterEach(() => vi.useRealTimers());

describe("TtsService.getStats", () => {
  it("starts empty", () => {
    const service = new TtsService(provider);
    expect(service.getStats()).toEqual({
      activeSyntheses: 0,
      queuedSyntheses: 0,
      rejectedSyntheses: { queueFull: 0, queueTimeout: 0, unknownVoice: 0 },
      voiceCatalog: null,
    });
  });

  it("tracks active, queued and rejected syntheses by reason", async () => {
    vi.useFakeTimers();
    const service = new TtsService(provider, { maxConcurrentSyntheses: 1, maxQueuedSyntheses: 1 });
    const signal = new AbortController().signal;

    const active = await service.synthesizeSegmented(REQUEST, signal, SEGMENTED);
    const queued = service.synthesizeSegmented(REQUEST, signal, SEGMENTED);
    const queuedOutcome = queued.catch((error: unknown) => error);
    await expect(service.synthesizeSegmented(REQUEST, signal, SEGMENTED)).rejects.toThrow(
      "Speech synthesis capacity is full",
    );
    expect(service.getStats()).toMatchObject({
      activeSyntheses: 1,
      queuedSyntheses: 1,
      rejectedSyntheses: { queueFull: 1, queueTimeout: 0 },
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(await queuedOutcome).toBeInstanceOf(Error);
    expect(service.getStats()).toMatchObject({
      queuedSyntheses: 0,
      rejectedSyntheses: { queueFull: 1, queueTimeout: 1 },
    });

    for await (const chunk of active.audio) void chunk;
    expect(service.getStats().activeSyntheses).toBe(0);
  });

  it("counts unknown voices and reports the cached catalog size and age", async () => {
    const clock = { now: 1_000 };
    const service = new TtsService(provider, { now: () => clock.now });
    await service.listVoices();
    clock.now = 4_000;

    await expect(
      service.synthesizeSegmented(
        { text: "hello", voice: "xx-XX-MissingNeural" },
        new AbortController().signal,
        SEGMENTED,
      ),
    ).rejects.toThrow("Requested voice is not in the voice catalog");

    expect(service.getStats()).toMatchObject({
      rejectedSyntheses: { unknownVoice: 1 },
      voiceCatalog: { voices: 2, ageMs: 3_000 },
    });
  });
});
