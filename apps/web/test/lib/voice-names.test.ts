import { describe, expect, it } from "vitest";
import { localeDisplayName, shortVoiceName } from "../../src/lib/voice-names.js";

describe("shortVoiceName", () => {
  it.each([
    ["Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)", "Xiaoxiao"],
    [
      "Microsoft Andrew Multilingual Online (Natural) - English (United States)",
      "Andrew Multilingual",
    ],
    ["Microsoft Xiaobei Online (Natural) - Chinese (Northeastern Mandarin)", "Xiaobei"],
    ["Microsoft Jenny", "Jenny"],
    ["Nanami", "Nanami"],
    ["Custom Voice - Studio", "Custom Voice"],
  ])("%s -> %s", (displayName, expected) => {
    expect(shortVoiceName({ displayName })).toBe(expected);
  });

  it("falls back to the display name when nothing would remain", () => {
    expect(shortVoiceName({ displayName: "Microsoft " })).toBe("Microsoft ");
  });
});

describe("localeDisplayName", () => {
  it("names locales in the interface language", () => {
    expect(localeDisplayName("zh-CN", "zh-CN")).toBe("中文（中国）");
    expect(localeDisplayName("en-US", "en")).toBe("American English");
    expect(localeDisplayName("ja-JP", "ja")).toBe("日本語 (日本)");
  });

  it("returns null for invalid locales", () => {
    expect(localeDisplayName("not a locale", "en")).toBeNull();
  });
});
