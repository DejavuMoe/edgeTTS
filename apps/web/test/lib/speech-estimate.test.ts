import { describe, expect, it } from "vitest";
import { AUDIO_BYTES_PER_SECOND, estimateSpeechSeconds } from "../../src/lib/speech-estimate.js";

/*
 * Real lengths at 1.0×, measured from the service's standard-quality output (bytes / 6000).
 * Where two voices read the same text, both are listed.
 */
const MEASURED = [
  {
    language: "zh",
    seconds: [26.14, 25.34],
    text:
      "今天的天气非常好，阳光明媚，微风轻拂。我们决定去公园散步，看看湖边新开的花。" +
      "路上遇到了几位老朋友，大家一起聊了聊最近的工作和生活。傍晚的时候，天边的云被夕阳染成了橙红色，" +
      "美得让人舍不得离开。回家的路上，我想，平凡的日子里也藏着许多值得珍惜的瞬间。",
  },
  {
    language: "en",
    seconds: [23.88, 22.46],
    text:
      "The weather was lovely today, bright and calm with a light breeze. We decided to walk " +
      "through the park and look at the new flowers by the lake. On the way we ran into a few " +
      "old friends and talked about work and life. By evening the clouds had turned orange in " +
      "the setting sun, and it was hard to leave. Walking home, I thought that ordinary days " +
      "hide many moments worth keeping.",
  },
  {
    language: "ja",
    seconds: [27.55],
    text:
      "今日はとても良い天気で、日差しが明るく、そよ風が吹いていました。私たちは公園を散歩して、" +
      "湖のそばに新しく咲いた花を見に行くことにしました。途中で何人かの古い友人に会い、" +
      "最近の仕事や生活について話しました。夕方には、空の雲が夕日でオレンジ色に染まり、" +
      "離れがたいほど美しかったです。",
  },
  {
    language: "ko",
    seconds: [17.38],
    text:
      "오늘은 날씨가 아주 좋았고 햇살이 밝고 바람이 살랑살랑 불었습니다. 우리는 공원을 산책하며 " +
      "호숫가에 새로 핀 꽃을 보기로 했습니다. 가는 길에 오랜 친구 몇 명을 만나 요즘 일과 생활에 " +
      "대해 이야기를 나눴습니다.",
  },
  {
    language: "fr",
    seconds: [10.06],
    text:
      "Il faisait très beau aujourd'hui, le soleil brillait et une légère brise soufflait. " +
      "Nous avons décidé de nous promener dans le parc pour voir les nouvelles fleurs près du lac.",
  },
];

describe("estimateSpeechSeconds", () => {
  it.each(MEASURED)("lands within 10% of the measured length of $language text", (sample) => {
    const estimate = estimateSpeechSeconds(sample.text);
    for (const seconds of sample.seconds) {
      expect(Math.abs(estimate - seconds) / seconds).toBeLessThan(0.1);
    }
  });

  it("shortens with speed, as the voices do", () => {
    const text = MEASURED[0]!.text;
    expect(estimateSpeechSeconds(text, 1.5)).toBeCloseTo(estimateSpeechSeconds(text) / 1.5, 6);
    expect(estimateSpeechSeconds(text, 0.5)).toBeCloseTo(estimateSpeechSeconds(text) * 2, 6);
  });

  it("gives no estimate for text with nothing to say, or an unusable speed", () => {
    expect(estimateSpeechSeconds("")).toBe(0);
    expect(estimateSpeechSeconds("   \n\t ★ ♪ → ")).toBe(0);
    expect(estimateSpeechSeconds("你好", 0)).toBe(0);
    expect(estimateSpeechSeconds("你好", Number.NaN)).toBe(0);
  });

  it("counts characters outside the Basic Multilingual Plane once", () => {
    // U+20000 is one Han character made of two UTF-16 code units.
    expect(estimateSpeechSeconds("\u{20000}")).toBeCloseTo(estimateSpeechSeconds("中"), 6);
  });
});

describe("AUDIO_BYTES_PER_SECOND", () => {
  it("matches the 48 and 96 kbps MP3 of each quality", () => {
    expect(AUDIO_BYTES_PER_SECOND.standard).toBe(48_000 / 8);
    expect(AUDIO_BYTES_PER_SECOND.high).toBe(96_000 / 8);
  });
});
