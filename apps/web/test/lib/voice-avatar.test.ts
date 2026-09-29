import { describe, expect, it, vi } from "vitest";
import {
  loadVoiceAvatars,
  subscribeVoiceAvatars,
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
