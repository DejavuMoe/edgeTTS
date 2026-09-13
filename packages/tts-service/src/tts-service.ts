import type { SynthesisRequest, SynthesisResult, TtsProvider, TtsVoice } from "@edgetts/tts-core";
import { VoiceCache } from "./voice-cache.js";

export interface TtsServiceOptions {
  readonly voiceCacheTtlMs?: number;
  readonly now?: () => number;
}

export interface ListVoicesOptions {
  readonly forceRefresh?: boolean;
}

export class TtsService {
  private readonly provider: TtsProvider;
  private readonly voiceCache: VoiceCache;

  constructor(provider: TtsProvider, options?: TtsServiceOptions) {
    this.provider = provider;
    this.voiceCache = new VoiceCache(provider, {
      ...(options?.voiceCacheTtlMs !== undefined ? { ttlMs: options.voiceCacheTtlMs } : {}),
      ...(options?.now !== undefined ? { now: options.now } : {}),
    });
  }

  async listVoices(options?: ListVoicesOptions): Promise<readonly TtsVoice[]> {
    return this.voiceCache.getVoices(options?.forceRefresh ?? false);
  }

  async synthesize(request: SynthesisRequest, signal: AbortSignal): Promise<SynthesisResult> {
    return this.provider.synthesize(request, signal);
  }
}
