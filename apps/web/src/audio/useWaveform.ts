import { useEffect, useState } from "react";
import { canDecodeWaveform, decodeWaveform, waveformBucketCount } from "./waveform.js";

/**
 * The waveform of the finished take at `url` (a local Blob URL), or null while it is decoding,
 * when the browser cannot decode, or when the take is too large to summarise.
 */
export function useWaveform(url: string | null | undefined): readonly number[] | null {
  const [result, setResult] = useState<{ url: string; peaks: number[] } | null>(null);

  useEffect(() => {
    if (!url || !canDecodeWaveform()) return;
    let current = true;
    void (async () => {
      try {
        const blob = await (await fetch(url)).blob();
        const peaks = await decodeWaveform(blob, waveformBucketCount());
        if (current && peaks) setResult({ url, peaks });
      } catch {
        // An undecodable take keeps the plain timeline.
      }
    })();
    return () => {
      current = false;
    };
  }, [url]);

  return result !== null && result.url === url ? result.peaks : null;
}
