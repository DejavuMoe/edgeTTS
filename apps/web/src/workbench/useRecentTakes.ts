import { useCallback, useEffect, useRef, useState } from "react";
import type { CompletedResultMeta } from "../lib/result-metadata.js";

/** Takes kept for comparison, the current one included. */
export const MAX_RECENT_TAKES = 5;
/** Audio kept in memory for them at most; the newest take is kept whatever its size. */
export const MAX_RECENT_TAKE_BYTES = 64 * 1024 * 1024;

export interface RecentTake {
  readonly id: string;
  /** An object URL of the take's audio, owned by the list until the take leaves it. */
  readonly url: string;
  readonly bytes: number;
  readonly result: CompletedResultMeta;
}

function revoke(takes: readonly RecentTake[]): void {
  for (const take of takes) {
    try {
      URL.revokeObjectURL(take.url);
    } catch {
      // Already released.
    }
  }
}

/**
 * The last few completed takes, newest first, so they can be played and downloaded side by side.
 * They live in memory only: nothing is stored, and leaving the page releases them.
 */
export function useRecentTakes() {
  const [takes, setTakes] = useState<readonly RecentTake[]>([]);
  const takesRef = useRef<readonly RecentTake[]>([]);
  const nextIdRef = useRef(0);

  const add = useCallback((audio: Blob, result: CompletedResultMeta): void => {
    const newest: RecentTake = {
      id: `take:${++nextIdRef.current}`,
      url: URL.createObjectURL(audio),
      bytes: audio.size,
      result,
    };
    const kept: RecentTake[] = [];
    const dropped: RecentTake[] = [];
    let bytes = 0;
    for (const take of [newest, ...takesRef.current]) {
      const fits =
        kept.length === 0 ||
        (dropped.length === 0 &&
          kept.length < MAX_RECENT_TAKES &&
          bytes + take.bytes <= MAX_RECENT_TAKE_BYTES);
      if (fits) {
        kept.push(take);
        bytes += take.bytes;
      } else {
        dropped.push(take);
      }
    }
    revoke(dropped);
    takesRef.current = kept;
    setTakes(kept);
  }, []);

  useEffect(
    () => () => {
      revoke(takesRef.current);
      takesRef.current = [];
      setTakes([]);
    },
    [],
  );

  return { takes, add };
}
