import type { TtsProvider, TtsVoice } from "@edgetts/tts-core";

export const DEFAULT_VOICE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface VoiceCacheOptions {
  readonly ttlMs?: number;
  readonly now?: () => number;
}

function cloneVoices(voices: readonly TtsVoice[]): readonly TtsVoice[] {
  return voices.map((v) => ({ ...v }));
}

export class VoiceCache {
  private readonly provider: TtsProvider;
  private readonly ttlMs: number;
  private readonly now: () => number;

  private cachedVoices: readonly TtsVoice[] | null = null;
  private cachedAt: number | null = null;
  private inFlight: Promise<readonly TtsVoice[]> | null = null;

  constructor(provider: TtsProvider, options?: VoiceCacheOptions) {
    this.provider = provider;

    const ttl = options?.ttlMs ?? DEFAULT_VOICE_CACHE_TTL_MS;
    if (!Number.isFinite(ttl) || ttl <= 0) {
      throw new RangeError("voiceCacheTtlMs must be a finite number greater than 0");
    }
    this.ttlMs = ttl;
    this.now = options?.now ?? Date.now;
  }

  async getVoices(forceRefresh = false): Promise<readonly TtsVoice[]> {
    if (!forceRefresh && this.cachedVoices !== null && this.cachedAt !== null) {
      const age = this.now() - this.cachedAt;
      if (age < this.ttlMs) {
        return cloneVoices(this.cachedVoices);
      }
    }

    if (this.inFlight !== null) {
      return this.inFlight.then(cloneVoices);
    }

    const fetchPromise = (async () => {
      try {
        const voices = await this.provider.listVoices();
        const snapshot = cloneVoices(voices);
        this.cachedAt = this.now();
        this.cachedVoices = snapshot;
        return snapshot;
      } finally {
        this.inFlight = null;
      }
    })();

    this.inFlight = fetchPromise;
    return fetchPromise.then(cloneVoices);
  }
}
