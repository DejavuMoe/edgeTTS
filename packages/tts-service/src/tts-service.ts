import type { SynthesisRequest, SynthesisResult, TtsProvider, TtsVoice } from "@edgetts/tts-core";
import { createAbortError, type Permit, SynthesisLimiter } from "./synthesis-limiter.js";
import { segmentText } from "./text-segmenter.js";
import { VoiceCache } from "./voice-cache.js";

export const DEFAULT_MAX_CONCURRENT_SYNTHESES = 4;
export const DEFAULT_MAX_QUEUED_SYNTHESES = 16;

export interface TtsServiceOptions {
  readonly voiceCacheTtlMs?: number;
  readonly now?: () => number;
  readonly maxConcurrentSyntheses?: number;
  readonly maxQueuedSyntheses?: number;
}

export interface ListVoicesOptions {
  readonly forceRefresh?: boolean;
}

export interface SegmentedSynthesisOptions {
  readonly maxSegmentCodePoints: number;
}

export class TtsService {
  private readonly provider: TtsProvider;
  private readonly voiceCache: VoiceCache;
  private readonly limiter: SynthesisLimiter;

  constructor(provider: TtsProvider, options?: TtsServiceOptions) {
    this.provider = provider;
    this.voiceCache = new VoiceCache(provider, {
      ...(options?.voiceCacheTtlMs !== undefined ? { ttlMs: options.voiceCacheTtlMs } : {}),
      ...(options?.now !== undefined ? { now: options.now } : {}),
    });
    this.limiter = new SynthesisLimiter({
      maxConcurrent: options?.maxConcurrentSyntheses ?? DEFAULT_MAX_CONCURRENT_SYNTHESES,
      maxQueued: options?.maxQueuedSyntheses ?? DEFAULT_MAX_QUEUED_SYNTHESES,
    });
  }

  async listVoices(options?: ListVoicesOptions): Promise<readonly TtsVoice[]> {
    return this.voiceCache.getVoices(options?.forceRefresh ?? false);
  }

  async synthesize(request: SynthesisRequest, signal: AbortSignal): Promise<SynthesisResult> {
    const permit = await this.limiter.acquire(signal);

    if (signal.aborted) {
      permit.release();
      throw createAbortError(signal.reason);
    }

    let rawResult: SynthesisResult;
    try {
      rawResult = await this.provider.synthesize(request, signal);
    } catch (error) {
      permit.release();
      throw error;
    }

    return this.wrapSynthesisResult(rawResult, signal, permit);
  }

  async synthesizeSegmented(
    request: SynthesisRequest,
    signal: AbortSignal,
    options: SegmentedSynthesisOptions,
  ): Promise<SynthesisResult> {
    if (
      options === null ||
      typeof options !== "object" ||
      typeof options.maxSegmentCodePoints !== "number" ||
      !Number.isInteger(options.maxSegmentCodePoints) ||
      options.maxSegmentCodePoints < 1
    ) {
      throw new RangeError("maxSegmentCodePoints must be a finite integer greater than 0");
    }

    if (signal.aborted) {
      throw createAbortError(signal.reason);
    }

    const segments =
      request.text.length === 0
        ? [request.text]
        : segmentText(request.text, { maxCodePoints: options.maxSegmentCodePoints });
    const segmentsToSynthesize = segments.length === 0 ? [request.text] : segments;

    const firstResult = await this.synthesize(
      {
        ...request,
        text: segmentsToSynthesize[0]!,
      },
      signal,
    );

    return {
      format: firstResult.format,
      contentType: firstResult.contentType,
      audio: this.streamSegmentedAudio(firstResult, segmentsToSynthesize, request, signal),
    };
  }

  private async *streamSegmentedAudio(
    firstResult: SynthesisResult,
    segments: readonly string[],
    request: SynthesisRequest,
    signal: AbortSignal,
  ): AsyncIterable<Uint8Array> {
    if (signal.aborted) {
      throw createAbortError(signal.reason);
    }

    for await (const chunk of firstResult.audio) {
      if (signal.aborted) {
        throw createAbortError(signal.reason);
      }
      yield chunk;
    }

    const { format, contentType } = firstResult;

    for (let i = 1; i < segments.length; i++) {
      if (signal.aborted) {
        throw createAbortError(signal.reason);
      }

      const nextResult = await this.synthesize(
        {
          ...request,
          text: segments[i]!,
        },
        signal,
      );

      if (nextResult.format !== format || nextResult.contentType !== contentType) {
        try {
          const iter = nextResult.audio[Symbol.asyncIterator]();
          await iter.return?.();
        } catch {
          // ignore cleanup failure
        }
        throw new Error(
          `Segment ${i} returned inconsistent audio metadata: expected format ${format}, got ${nextResult.format}; expected contentType ${contentType}, got ${nextResult.contentType}`,
        );
      }

      for await (const chunk of nextResult.audio) {
        if (signal.aborted) {
          throw createAbortError(signal.reason);
        }
        yield chunk;
      }
    }
  }

  private wrapSynthesisResult(
    result: SynthesisResult,
    signal: AbortSignal,
    permit: Permit,
  ): SynthesisResult {
    let released = false;
    const releaseOnce = () => {
      if (!released) {
        released = true;
        signal.removeEventListener("abort", onAbort);
        permit.release();
      }
    };

    const onAbort = () => {
      releaseOnce();
    };

    if (signal.aborted) {
      releaseOnce();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const upstreamAudio = result.audio;

    async function* streamAudio(): AsyncIterable<Uint8Array> {
      try {
        for await (const chunk of upstreamAudio) {
          yield chunk;
        }
      } finally {
        releaseOnce();
      }
    }

    return {
      format: result.format,
      contentType: result.contentType,
      audio: streamAudio(),
    };
  }
}
