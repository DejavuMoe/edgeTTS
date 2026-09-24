import { describe, expect, it } from "vitest";
import {
  isTtsError,
  type SynthesisRequest,
  type SynthesisResult,
  type TtsProvider,
  type TtsVoice,
} from "@edgetts/tts-core";
import { TtsService } from "../src/index.js";

const CATALOG: readonly TtsVoice[] = [
  { id: "zh-CN-XiaoxiaoNeural", displayName: "Xiaoxiao", locale: "zh-CN", gender: "Female" },
  { id: "en-US-JennyNeural", displayName: "Jenny", locale: "en-US", gender: "Female" },
];

class RecordingProvider implements TtsProvider {
  listVoicesCalls = 0;
  readonly synthesized: string[] = [];

  listVoices(): Promise<readonly TtsVoice[]> {
    this.listVoicesCalls++;
    return Promise.resolve(CATALOG);
  }

  synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    this.synthesized.push(request.voice);
    return Promise.resolve({
      format: request.format ?? "mp3-48k",
      contentType: "audio/mpeg",
      audio: (async function* () {
        yield new Uint8Array([1]);
      })(),
    });
  }
}

const TTL_MS = 60_000;

function createService(provider: RecordingProvider, clock = { now: 0 }) {
  return new TtsService(provider, {
    voiceCacheTtlMs: TTL_MS,
    now: () => clock.now,
    maxConcurrentSyntheses: 1,
    maxQueuedSyntheses: 0,
  });
}

const SEGMENTED = { maxSegmentCodePoints: 300 };

async function drain(audio: AsyncIterable<Uint8Array>): Promise<void> {
  for await (const chunk of audio) void chunk;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected rejection");
    },
    (error: unknown) => error,
  );
}

describe("voice validation against the cached catalog", () => {
  it("rejects an unknown voice before using capacity or the provider", async () => {
    const provider = new RecordingProvider();
    const service = createService(provider);
    await service.listVoices();
    const signal = new AbortController().signal;

    const error = await rejection(
      service.synthesizeSegmented(
        { text: "hello", voice: "xx-XX-MissingNeural" },
        signal,
        SEGMENTED,
      ),
    );

    expect(isTtsError(error) && error.code).toBe("unknown_voice");
    expect(provider.synthesized).toEqual([]);
    // The single permit is still free: a known voice is admitted immediately.
    const result = await service.synthesizeSegmented(
      { text: "hello", voice: "zh-CN-XiaoxiaoNeural" },
      signal,
      SEGMENTED,
    );
    await drain(result.audio);
    expect(provider.synthesized).toEqual(["zh-CN-XiaoxiaoNeural"]);
  });

  it("applies the same rule to non-segmented synthesis", async () => {
    const provider = new RecordingProvider();
    const service = createService(provider);
    await service.listVoices();

    const error = await rejection(
      service.synthesize(
        { text: "hello", voice: "xx-XX-MissingNeural" },
        new AbortController().signal,
      ),
    );

    expect(isTtsError(error) && error.code).toBe("unknown_voice");
    expect(provider.synthesized).toEqual([]);
  });

  it("matches voice identifiers case-insensitively", async () => {
    const provider = new RecordingProvider();
    const service = createService(provider);
    await service.listVoices();

    const result = await service.synthesizeSegmented(
      { text: "hello", voice: "en-us-jennyneural" },
      new AbortController().signal,
      SEGMENTED,
    );
    await drain(result.audio);

    expect(provider.synthesized).toEqual(["en-us-jennyneural"]);
  });

  it("admits any voice and never fetches the catalog while the cache is cold", async () => {
    const provider = new RecordingProvider();
    const service = createService(provider);

    const result = await service.synthesizeSegmented(
      { text: "hello", voice: "xx-XX-MissingNeural" },
      new AbortController().signal,
      SEGMENTED,
    );
    await drain(result.audio);

    expect(provider.synthesized).toEqual(["xx-XX-MissingNeural"]);
    expect(provider.listVoicesCalls).toBe(0);
  });

  it("admits any voice without refetching once the cached catalog has expired", async () => {
    const provider = new RecordingProvider();
    const clock = { now: 0 };
    const service = createService(provider, clock);
    await service.listVoices();
    clock.now = TTL_MS;

    const result = await service.synthesizeSegmented(
      { text: "hello", voice: "xx-XX-MissingNeural" },
      new AbortController().signal,
      SEGMENTED,
    );
    await drain(result.audio);

    expect(provider.synthesized).toEqual(["xx-XX-MissingNeural"]);
    expect(provider.listVoicesCalls).toBe(1);
  });
});
