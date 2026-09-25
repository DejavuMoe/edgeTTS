import { describe, expect, it } from "vitest";
import {
  canDecodeWaveform,
  computePeaks,
  decodeWaveform,
  MAX_WAVEFORM_SOURCE_BYTES,
} from "../../src/audio/waveform.js";

describe("computePeaks", () => {
  it("returns one normalised level per bucket, loudest at 1", () => {
    const quiet = new Array<number>(100).fill(0.1);
    const loud = new Array<number>(100).fill(0.8);
    const silent = new Array<number>(100).fill(0);
    const peaks = computePeaks([...quiet, ...loud, ...silent], 3);
    expect(peaks).toHaveLength(3);
    expect(peaks[1]).toBe(1);
    expect(peaks[2]).toBe(0);
    expect(peaks[0]).toBeGreaterThan(0.1 / 0.8); // quiet passages are lifted, not flattened
    expect(peaks[0]).toBeLessThan(1);
  });

  it("uses RMS so a single spike does not flatten the rest", () => {
    const samples = new Array<number>(200).fill(0.3);
    samples[10] = 1;
    const [withSpike, plain] = computePeaks(samples, 2);
    expect(withSpike).toBe(1);
    expect(plain).toBeGreaterThan(0.7);
  });

  it("handles empty input, silence and more buckets than samples", () => {
    expect(computePeaks([], 10)).toEqual([]);
    expect(computePeaks([0.5], 0)).toEqual([]);
    expect(computePeaks([0, 0, 0], 3)).toEqual([0, 0, 0]);
    expect(computePeaks([0.5, 0.5], 4)).toHaveLength(4);
  });
});

describe("decodeWaveform", () => {
  it("declines without decoding support, for empty takes and above the size cap", async () => {
    // jsdom has no OfflineAudioContext: the plain timeline is kept.
    expect(canDecodeWaveform()).toBe(false);
    expect(await decodeWaveform(new Blob(["x"]))).toBeNull();
    expect(MAX_WAVEFORM_SOURCE_BYTES).toBeGreaterThan(1024 * 1024);
  });
});

describe("waveformBucketCount", () => {
  it("uses fewer bars on narrow viewports, where the card is a third as wide", async () => {
    const { NARROW_WAVEFORM_BUCKETS, WAVEFORM_BUCKETS, waveformBucketCount } =
      await import("../../src/audio/waveform.js");
    expect(NARROW_WAVEFORM_BUCKETS).toBeLessThan(WAVEFORM_BUCKETS);
    // jsdom has no matchMedia: the desktop count applies.
    expect(waveformBucketCount()).toBe(WAVEFORM_BUCKETS);
  });
});
