import type { TtsProvider, TtsVoice } from "@edgetts/tts-core";

export const DEFAULT_VOICE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
export const DEFAULT_VOICE_CACHE_ERROR_BACKOFF_MS = 5000; // 5 seconds

export interface VoiceCacheOptions {
  readonly ttlMs?: number;
  readonly errorBackoffMs?: number;
  readonly now?: () => number;
}

function cloneVoices(voices: readonly TtsVoice[]): readonly TtsVoice[] {
  return voices.map((v) => ({ ...v }));
}

export class VoiceCache {
  private readonly provider: TtsProvider;
  private readonly ttlMs: number;
  private readonly errorBackoffMs: number;
  private readonly now: () => number;

  private cachedVoices: readonly TtsVoice[] | null = null;
  private cachedAt: number | null = null;
  private inFlight: Promise<readonly TtsVoice[]> | null = null;
  private lastErrorAt: number | null = null;

  constructor(provider: TtsProvider, options?: VoiceCacheOptions) {
    this.provider = provider;

    const ttl = options?.ttlMs ?? DEFAULT_VOICE_CACHE_TTL_MS;
    if (!Number.isFinite(ttl) || ttl <= 0) {
      throw new RangeError("voiceCacheTtlMs must be a finite number greater than 0");
    }
    this.ttlMs = ttl;

    const errorBackoff = options?.errorBackoffMs ?? DEFAULT_VOICE_CACHE_ERROR_BACKOFF_MS;
    if (!Number.isFinite(errorBackoff) || errorBackoff < 0) {
      throw new RangeError("errorBackoffMs must be a finite number greater than or equal to 0");
    }
    this.errorBackoffMs = errorBackoff;

    this.now = options?.now ?? Date.now;
  }

  /** Size and age of the cached catalog, or null before the first successful fetch. */
  snapshotInfo(): { readonly voices: number; readonly ageMs: number } | null {
    if (this.cachedVoices === null || this.cachedAt === null) {
      return null;
    }
    return { voices: this.cachedVoices.length, ageMs: this.now() - this.cachedAt };
  }

  /** The cached catalog while it is within its TTL. Never triggers an upstream fetch. */
  peekFresh(): readonly TtsVoice[] | null {
    if (this.cachedVoices === null || this.cachedAt === null) {
      return null;
    }
    return this.now() - this.cachedAt < this.ttlMs ? this.cachedVoices : null;
  }

  async getVoices(forceRefresh = false): Promise<readonly TtsVoice[]> {
    if (!forceRefresh && this.cachedVoices !== null && this.cachedAt !== null) {
      const age = this.now() - this.cachedAt;
      if (age < this.ttlMs) {
        return cloneVoices(this.cachedVoices);
      }
      if (this.lastErrorAt !== null && this.now() - this.lastErrorAt < this.errorBackoffMs) {
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
        this.lastErrorAt = null;
        return snapshot;
      } catch (err) {
        this.lastErrorAt = this.now();
        if (this.cachedVoices !== null && !forceRefresh) {
          return cloneVoices(this.cachedVoices);
        }
        throw err;
      } finally {
        this.inFlight = null;
      }
    })();

    this.inFlight = fetchPromise;
    return fetchPromise.then(cloneVoices);
  }
}
