import { describe, expect, it } from "vitest";
import { voiceHeritage, voicePersona } from "../../src/lib/voice-persona.js";

describe("voiceHeritage", () => {
  it.each([
    ["zh-CN", "eastAsian"],
    ["zh-CN-liaoning", "eastAsian"],
    ["zh-TW", "eastAsian"],
    ["ja-JP", "eastAsian"],
    ["ko-KR", "eastAsian"],
    ["vi-VN", "southeastAsian"],
    ["fil-PH", "southeastAsian"],
    ["hi-IN", "southAsian"],
    ["en-IN", "southAsian"],
    // Tamil voices look South Asian in Singapore and Malaysia too.
    ["ta-SG", "southAsian"],
    ["ta-MY", "southAsian"],
    ["ar-EG", "middleEastern"],
    ["fa-IR", "middleEastern"],
    ["kk-KZ", "centralAsian"],
    ["sw-KE", "african"],
    ["en-NG", "african"],
    ["es-GQ", "african"],
    ["zu-ZA", "african"],
    ["af-ZA", "southAfrican"],
    ["sv-SE", "nordic"],
    ["ga-IE", "celtic"],
    ["en-IE", "celtic"],
    ["de-DE", "westEuropean"],
    ["fr-FR", "westEuropean"],
    ["it-IT", "southEuropean"],
    ["es-ES", "southEuropean"],
    ["pt-PT", "southEuropean"],
    ["ru-RU", "eastEuropean"],
    ["es-MX", "latinAmerican"],
    ["pt-BR", "latinAmerican"],
    ["es-CU", "caribbean"],
    ["iu-Latn-CA", "arctic"],
    ["iu-Cans-CA", "arctic"],
    ["en-US", "multicultural"],
    ["fr-CA", "multicultural"],
  ])("%s -> %s", (locale, heritage) => {
    expect(voiceHeritage(locale)).toBe(heritage);
  });

  it("falls back to a mixed cast for locales it does not know", () => {
    expect(voiceHeritage("xx-YY")).toBe("multicultural");
    expect(voiceHeritage("")).toBe("multicultural");
  });
});

describe("voicePersona", () => {
  it("gives women and men their own haircuts, and stubble only to men", () => {
    const woman = voicePersona({ locale: "zh-CN", gender: "Female" });
    const man = voicePersona({ locale: "zh-CN", gender: "Male" });
    expect(Object.keys(woman.hairStyles)).toContain("roundBob");
    expect(Object.keys(woman.hairStyles)).not.toContain("flatTop");
    expect(Object.keys(man.hairStyles)).toContain("parting");
    expect(Object.keys(man.hairStyles)).not.toContain("longCurls");
    expect(woman.facialHairProbability).toBe(0);
    expect(man.facialHairProbability).toBeGreaterThan(0);
  });

  it("draws skin and hair from the locale's palette", () => {
    const nordic = voicePersona({ locale: "nb-NO", gender: "Female" });
    const african = voicePersona({ locale: "sw-TZ", gender: "Female" });
    expect(nordic.hairColors).toContain("#e2b85a");
    expect(african.hairColors).toEqual(["#1f1a17"]);
    expect(african.skinColors.filter((tone) => nordic.skinColors.includes(tone))).toEqual([]);
    // Curly textures favour curls.
    expect(Object.entries(african.hairStyles).sort((a, b) => b[1] - a[1])[0]?.[0]).toBe(
      "longCurls",
    );
  });

  it("keeps an unknown gender out of the gendered details", () => {
    const persona = voicePersona({ locale: "en-US", gender: "Unknown" });
    expect(persona.facialHairProbability).toBe(0);
    expect(Object.keys(persona.hairStyles).length).toBeGreaterThan(0);
  });
});
