/**
 * Waveform summaries of a finished take, computed in the browser from the MP3 it already holds.
 * Nothing is uploaded or stored; a take that cannot be decoded simply keeps the plain timeline.
 */

/** Bars drawn across the timeline. Enough for shape, few enough to render as one SVG. */
export const WAVEFORM_BUCKETS = 160;

/**
 * Takes above this size keep the plain timeline. Decoding at 8 kHz needs about 32 KiB of PCM per
 * second, so 12 MiB of 48 kbps MP3 (about half an hour) decodes to roughly 60 MiB.
 */
export const MAX_WAVEFORM_SOURCE_BYTES = 12 * 1024 * 1024;

/** Narrow cards get fewer bars, so the gaps between them survive the smaller width. */
export const NARROW_WAVEFORM_BUCKETS = 96;

const DECODE_SAMPLE_RATE = 8000;
const NARROW_QUERY = "(max-width: 767px)";

/** Bars for the current viewport: the phone card is about a third of the desktop one. */
export function waveformBucketCount(): number {
  const narrow = globalThis.matchMedia?.(NARROW_QUERY)?.matches ?? false;
  return narrow ? NARROW_WAVEFORM_BUCKETS : WAVEFORM_BUCKETS;
}

/**
 * Loudness per bucket, normalised to 0..1. RMS rather than peak keeps speech readable: plosives
 * do not flatten everything else. A gentle curve lifts quiet passages so pauses still read as
 * pauses without the line collapsing between words.
 */
export function computePeaks(samples: ArrayLike<number>, buckets: number): number[] {
  if (buckets <= 0 || samples.length === 0) return [];
  const size = samples.length / buckets;
  const levels: number[] = [];
  let loudest = 0;
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = Math.floor(bucket * size);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((bucket + 1) * size)));
    let sum = 0;
    for (let i = start; i < end; i++) {
      const value = samples[i]!;
      sum += value * value;
    }
    const rms = Math.sqrt(sum / Math.max(1, end - start));
    levels.push(rms);
    loudest = Math.max(loudest, rms);
  }
  return levels.map((level) => (loudest > 0 ? Math.pow(level / loudest, 0.7) : 0));
}

/** Whether this browser can decode audio off the main output graph. */
export function canDecodeWaveform(): boolean {
  return typeof globalThis.OfflineAudioContext === "function";
}

export async function decodeWaveform(
  blob: Blob,
  buckets = WAVEFORM_BUCKETS,
): Promise<number[] | null> {
  if (!canDecodeWaveform() || blob.size === 0 || blob.size > MAX_WAVEFORM_SOURCE_BYTES) return null;
  const context = new OfflineAudioContext(1, 1, DECODE_SAMPLE_RATE);
  const audio = await context.decodeAudioData(await blob.arrayBuffer());
  return computePeaks(audio.getChannelData(0), buckets);
}
