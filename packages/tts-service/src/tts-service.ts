import type { SynthesisRequest, SynthesisResult, TtsProvider, TtsVoice } from "@edgetts/tts-core";
import { createAbortError, type Permit, SynthesisLimiter } from "./synthesis-limiter.js";
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
