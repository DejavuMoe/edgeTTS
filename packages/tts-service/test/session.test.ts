import { describe, expect, it } from "vitest";
import type {
  SessionSynthesisRequest,
  SynthesisResult,
  SynthesisSession,
  SynthesisSessionOptions,
  TtsProvider,
  TtsVoice,
} from "@edgetts/tts-core";
import { TtsService } from "../src/index.js";

const VOICE = "zh-CN-XiaoxiaoNeural";
// Three segments of at most 5 code points each.
const TEXT = "aaaa bbbb cccc";
const SEGMENTED = { maxSegmentCodePoints: 5 };

function audio(bytes: number[], failAfter = false): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield new Uint8Array(bytes);
    if (failAfter) throw new Error("segment stream failed");
  })();
}

class SessionProvider implements TtsProvider {
  readonly opened: SynthesisSessionOptions[] = [];
  readonly requests: SessionSynthesisRequest[] = [];
  perRequestCalls = 0;
  closeCalls = 0;
  openError: Error | undefined = undefined;
  failOnSegment: { index: number; during: "request" | "stream" } | undefined = undefined;

  listVoices(): Promise<readonly TtsVoice[]> {
    return Promise.resolve([{ id: VOICE, displayName: "X", locale: "zh-CN", gender: "Female" }]);
  }

  synthesize(): Promise<SynthesisResult> {
    this.perRequestCalls++;
    return Promise.reject(new Error("per-request synthesis must not be used"));
  }

  openSession(options: SynthesisSessionOptions): Promise<SynthesisSession> {
    if (this.openError) return Promise.reject(this.openError);
    this.opened.push(options);
    return Promise.resolve({
      synthesize: (request: SessionSynthesisRequest): Promise<SynthesisResult> => {
        const index = this.requests.length;
        this.requests.push(request);
        const failure = this.failOnSegment?.index === index ? this.failOnSegment : null;
        if (failure?.during === "request") return Promise.reject(new Error("segment failed"));
        return Promise.resolve({
          format: options.format ?? "mp3-48k",
          contentType: "audio/mpeg",
          audio: audio([index], failure?.during === "stream"),
        });
      },
      close: () => {
        this.closeCalls++;
      },
    });
  }
}

function createService(provider: TtsProvider) {
  return new TtsService(provider, { maxConcurrentSyntheses: 1, maxQueuedSyntheses: 0 });
}

async function collect(iterable: AsyncIterable<Uint8Array>): Promise<number[]> {
  const bytes: number[] = [];
  for await (const chunk of iterable) bytes.push(...chunk);
  return bytes;
}

/** The single permit is free again iff another synthesis is admitted immediately. */
async function expectPermitFree(service: TtsService): Promise<void> {
  const probe = await service.synthesizeSegmented(
    { text: "ok", voice: VOICE },
    new AbortController().signal,
    SEGMENTED,
  );
  await collect(probe.audio);
}

describe("segmented synthesis over a provider session", () => {
  it("uses one session for every segment and closes it once at the end", async () => {
    const provider = new SessionProvider();
    const service = createService(provider);

    const result = await service.synthesizeSegmented(
      { text: TEXT, voice: VOICE, format: "mp3-96k", prosody: { speed: 1.25 } },
      new AbortController().signal,
      SEGMENTED,
    );

    expect(result.segmentCount).toBe(3);
    expect(await collect(result.audio)).toEqual([0, 1, 2]);
    expect(provider.opened).toEqual([{ voice: VOICE, format: "mp3-96k" }]);
    expect(provider.requests).toEqual([
      { text: "aaaa ", prosody: { speed: 1.25 } },
      { text: "bbbb ", prosody: { speed: 1.25 } },
      { text: "cccc", prosody: { speed: 1.25 } },
    ]);
    expect(provider.perRequestCalls).toBe(0);
    expect(provider.closeCalls).toBe(1);
    await expectPermitFree(service);
  });

  it("closes the session and frees the permit when the client aborts", async () => {
    const provider = new SessionProvider();
    const service = createService(provider);
    const controller = new AbortController();
    const result = await service.synthesizeSegmented(
      { text: TEXT, voice: VOICE },
      controller.signal,
      SEGMENTED,
    );
    const iterator = result.audio[Symbol.asyncIterator]();
    await iterator.next();

    controller.abort();

    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(provider.closeCalls).toBe(1);
    await expectPermitFree(service);
  });

  it("closes the session when the consumer stops early", async () => {
    const provider = new SessionProvider();
    const service = createService(provider);
    const result = await service.synthesizeSegmented(
      { text: TEXT, voice: VOICE },
      new AbortController().signal,
      SEGMENTED,
    );

    for await (const chunk of result.audio) {
      void chunk;
      break;
    }

    expect(provider.closeCalls).toBe(1);
    await expectPermitFree(service);
  });

  it("frees the permit when opening the session fails", async () => {
    const provider = new SessionProvider();
    provider.openError = new Error("connect failed");
    const service = createService(provider);

    await expect(
      service.synthesizeSegmented(
        { text: TEXT, voice: VOICE },
        new AbortController().signal,
        SEGMENTED,
      ),
    ).rejects.toThrow("connect failed");
    expect(provider.closeCalls).toBe(0);

    provider.openError = undefined;
    await expectPermitFree(service);
  });

  it.each([
    { index: 0, during: "request" as const, where: "first segment request" },
    { index: 1, during: "request" as const, where: "later segment request" },
    { index: 1, during: "stream" as const, where: "later segment stream" },
  ])("closes the session once when the $where fails", async ({ index, during }) => {
    const provider = new SessionProvider();
    provider.failOnSegment = { index, during };
    const service = createService(provider);

    const outcome = service
      .synthesizeSegmented({ text: TEXT, voice: VOICE }, new AbortController().signal, SEGMENTED)
      .then((result) => collect(result.audio));

    await expect(outcome).rejects.toThrow(/segment (stream )?failed/);
    expect(provider.closeCalls).toBe(1);
    provider.failOnSegment = undefined;
    await expectPermitFree(service);
  });

  it("rejects an unknown voice before opening a session", async () => {
    const provider = new SessionProvider();
    const service = createService(provider);
    await service.listVoices();

    await expect(
      service.synthesizeSegmented(
        { text: TEXT, voice: "xx-XX-MissingNeural" },
        new AbortController().signal,
        SEGMENTED,
      ),
    ).rejects.toThrow("Requested voice is not in the voice catalog");
    expect(provider.opened).toEqual([]);
  });
});
