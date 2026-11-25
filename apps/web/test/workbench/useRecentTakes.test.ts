import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompletedResultMeta } from "../../src/lib/result-metadata.js";
import {
  MAX_RECENT_TAKE_BYTES,
  MAX_RECENT_TAKES,
  useRecentTakes,
} from "../../src/workbench/useRecentTakes.js";

const MIB = 1024 * 1024;

function result(completedAt: number): CompletedResultMeta {
  return {
    voiceId: "zh-CN-XiaoxiaoNeural",
    voiceDisplayName: "Microsoft Xiaoxiao",
    quality: "standard",
    speed: 1,
    pitchSemitones: 0,
    volume: 1,
    completedAt,
    filename: `take-${completedAt}.mp3`,
  };
}

/** A take's audio by size alone: the list reads nothing else from it. */
function audioOf(bytes: number): Blob {
  return { size: bytes } as Blob;
}

describe("useRecentTakes", () => {
  let created: string[];
  let revoked: string[];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    created = [];
    revoked = [];
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:take-${created.length + 1}`;
      created.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it("keeps the newest takes first, up to five, releasing the audio of older ones", () => {
    const { result: hook } = renderHook(() => useRecentTakes());
    for (let index = 1; index <= MAX_RECENT_TAKES + 2; index++) {
      act(() => hook.current.add(audioOf(1000), result(index)));
    }
    expect(MAX_RECENT_TAKES).toBe(5);
    expect(hook.current.takes.map((take) => take.result.completedAt)).toEqual([7, 6, 5, 4, 3]);
    expect(hook.current.takes.map((take) => take.url)).toEqual(created.slice(2).reverse());
    expect(revoked).toEqual(["blob:take-1", "blob:take-2"]);
    expect(new Set(hook.current.takes.map((take) => take.id)).size).toBe(MAX_RECENT_TAKES);
  });

  it("keeps no more audio than the memory cap, but always the newest take", () => {
    expect(MAX_RECENT_TAKE_BYTES).toBe(64 * MIB);
    const { result: hook } = renderHook(() => useRecentTakes());
    act(() => hook.current.add(audioOf(20 * MIB), result(1)));
    act(() => hook.current.add(audioOf(30 * MIB), result(2)));
    act(() => hook.current.add(audioOf(10 * MIB), result(3)));
    expect(hook.current.takes.map((take) => take.result.completedAt)).toEqual([3, 2, 1]);

    // 70 MiB with the oldest: it goes, and so would anything older.
    act(() => hook.current.add(audioOf(10 * MIB), result(4)));
    expect(hook.current.takes.map((take) => take.result.completedAt)).toEqual([4, 3, 2]);
    expect(revoked).toEqual(["blob:take-1"]);

    // A take larger than the cap on its own is still the current one.
    act(() => hook.current.add(audioOf(100 * MIB), result(5)));
    expect(hook.current.takes.map((take) => take.result.completedAt)).toEqual([5]);
    expect(hook.current.takes[0]?.bytes).toBe(100 * MIB);
    expect(revoked).toEqual(["blob:take-1", "blob:take-4", "blob:take-3", "blob:take-2"]);
  });

  it("releases every take's audio when the page lets go of them", () => {
    const { result: hook, unmount } = renderHook(() => useRecentTakes());
    act(() => hook.current.add(audioOf(1000), result(1)));
    act(() => hook.current.add(audioOf(1000), result(2)));
    expect(revoked).toEqual([]);
    unmount();
    expect(revoked.sort()).toEqual(["blob:take-1", "blob:take-2"]);
  });
});
