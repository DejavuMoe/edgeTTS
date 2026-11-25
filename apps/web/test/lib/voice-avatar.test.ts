import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AVATAR_SLICE_MS,
  cachedVoiceAvatar,
  loadVoiceAvatars,
  requestVoiceAvatar,
  subscribeVoiceAvatar,
  subscribeVoiceAvatars,
  voiceAvatarKey,
  voiceAvatarsReady,
  voiceAvatarUri,
} from "../../src/lib/voice-avatar.js";

const XIAOXIAO = { id: "zh-CN-XiaoxiaoNeural", locale: "zh-CN", gender: "Female" };
const YUNXI = { id: "zh-CN-YunxiNeural", locale: "zh-CN", gender: "Male" };

function decode(uri: string): string {
  return decodeURIComponent(uri.slice(uri.indexOf(",") + 1));
}

describe("voice avatars", () => {
  it("renders nothing until the renderer loads, then notifies subscribers once", async () => {
    // The first test in this file sees the module before anything loaded it.
    expect(voiceAvatarsReady()).toBe(false);
    expect(voiceAvatarUri(XIAOXIAO)).toBeNull();

    const listener = vi.fn();
    const unsubscribe = subscribeVoiceAvatars(listener);
    await Promise.all([loadVoiceAvatars(), loadVoiceAvatars()]);
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(voiceAvatarsReady()).toBe(true);
  });

  it("draws a stable SVG portrait per voice with a transparent background", async () => {
    await loadVoiceAvatars();
    const uri = voiceAvatarUri(XIAOXIAO);
    expect(uri).toMatch(/^data:image\/svg\+xml/);
    expect(voiceAvatarUri(XIAOXIAO)).toBe(uri);
    expect(voiceAvatarUri(YUNXI)).not.toBe(uri);

    const svg = decode(uri ?? "");
    expect(svg).toContain("<svg");
    // The frame behind the portrait carries the voice's colour, so no background rect.
    expect(svg).not.toMatch(/<rect[^>]*fill=/);
    // Dylan is CC BY 4.0; the attribution travels inside every SVG.
    expect(svg).toContain("Natalia Spivak");
  });

  it("uses the locale's palette for the skin", async () => {
    await loadVoiceAvatars();
    const svg = decode(
      voiceAvatarUri({ id: "sw-KE-ZuriNeural", locale: "sw-KE", gender: "Female" }) ?? "",
    );
    expect(svg).toMatch(/#(9b623f|6e4128|4d2c1c)/i);
  });
});

describe("queued voice avatars", () => {
  const voices = Array.from({ length: 5 }, (_, index) => ({
    id: `ja-JP-Voice${index}Neural`,
    locale: "ja-JP",
    gender: index % 2 ? "Male" : "Female",
  }));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws requested portraits a slice at a time and tells each voice once", async () => {
    await loadVoiceAvatars();
    const keys = voices.map(voiceAvatarKey);
    const drawnWhenNotified: number[][] = keys.map(() => []);
    const unsubscribes = keys.map((key, index) =>
      subscribeVoiceAvatar(key, () => {
        drawnWhenNotified[index]!.push(keys.filter((k) => cachedVoiceAvatar(k)).length);
      }),
    );
    // Every portrait appears to take a whole slice, so each slice draws exactly one.
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += AVATAR_SLICE_MS));

    for (const voice of voices) requestVoiceAvatar(voice);
    requestVoiceAvatar(voices[0]!);
    // Nothing is drawn while the requesting components render.
    expect(keys.map(cachedVoiceAvatar)).toEqual(keys.map(() => null));

    await vi.waitFor(() => expect(drawnWhenNotified.every((calls) => calls.length > 0)).toBe(true));
    // Oldest request first, one portrait per slice, one notification per voice.
    expect(drawnWhenNotified).toEqual([[1], [2], [3], [4], [5]]);
    expect(cachedVoiceAvatar(keys[0]!)).toBe(voiceAvatarUri(voices[0]!));

    // A drawn portrait is not queued again.
    requestVoiceAvatar(voices[0]!);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(drawnWhenNotified[0]).toEqual([1]);
    for (const unsubscribe of unsubscribes) unsubscribe();
  });
});
