import { describe, expect, it } from "vitest";
import { voiceSampleText } from "../../src/lib/voice-sample.js";

const ENGLISH = "Hello, nice to meet you. This is what my voice sounds like.";

describe("voiceSampleText", () => {
  it("speaks the voice's own written Chinese, by region", () => {
    expect(voiceSampleText("zh-CN")).toBe("你好，很高兴认识你。这就是我的声音。");
    expect(voiceSampleText("zh-TW")).toBe("你好，很高興認識你。這就是我的聲音。");
    expect(voiceSampleText("zh-HK")).toBe("你好，好高興認識你。呢個就係我嘅聲音。");
    expect(voiceSampleText("zh-CN-liaoning")).toBe(voiceSampleText("zh-CN"));
    expect(voiceSampleText("wuu-CN")).toBe(voiceSampleText("zh-CN"));
    expect(voiceSampleText("yue-CN")).toBe("你好，好高兴认识你。呢个就系我嘅声音。");
  });

  it("shares one line between the regions of a language", () => {
    expect(voiceSampleText("en-US")).toBe(ENGLISH);
    expect(voiceSampleText("en-GB")).toBe(ENGLISH);
    expect(voiceSampleText("fr-CA")).toBe(voiceSampleText("fr-FR"));
    expect(voiceSampleText("ja-JP")).toBe("こんにちは、はじめまして。これが私の声です。");
    expect(voiceSampleText("ko-KR")).toBe("안녕하세요, 만나서 반갑습니다. 이것이 제 목소리입니다.");
  });

  it("says the language's own name and a date in it when there is no line for it", () => {
    const swahili = voiceSampleText("sw-KE");
    expect(swahili).not.toBe(ENGLISH);
    expect(swahili).toContain("2024");
    expect(swahili).toBe(
      `${new Intl.DisplayNames(["sw-KE"], { type: "language" }).of("sw-KE")}. ${new Intl.DateTimeFormat(
        "sw-KE",
        { dateStyle: "full", timeZone: "UTC" },
      ).format(new Date(Date.UTC(2024, 4, 1, 12)))}`,
    );
    // The same each time, so a cached preview stays valid.
    expect(voiceSampleText("sw-KE")).toBe(swahili);
  });

  it("falls back to English for a locale the browser cannot read", () => {
    expect(voiceSampleText("not a locale!")).toBe(ENGLISH);
  });
});
