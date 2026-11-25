import { describe, it, expect } from "vitest";
import type { VoiceDto } from "@edgetts/shared";
import type { UiLocale } from "../../src/i18n.js";
import {
  getLocaleOptions,
  matchesVoiceSearch,
  filterVoices,
  getGroupedVoices,
  isVoiceVisible,
} from "../../src/lib/voice-catalog.js";

const testVoices: readonly VoiceDto[] = [
  {
    id: "zh-CN-XiaoxiaoNeural",
    displayName: "Microsoft Xiaoxiao",
    locale: "zh-CN",
    gender: "Female",
  },
  {
    id: "zh-CN-YunxiNeural",
    displayName: "Microsoft Yunxi",
    locale: "zh-CN",
    gender: "Male",
  },
  {
    id: "en-US-JennyNeural",
    displayName: "Microsoft Jenny",
    locale: "en-US",
    gender: "Female",
  },
  {
    id: "en-GB-SoniaNeural",
    displayName: "Microsoft Sonia",
    locale: "en-GB",
    gender: "Female",
  },
  {
    id: "ja-JP-NanamiNeural",
    displayName: "Microsoft Nanami",
    locale: "ja-JP",
    gender: "Female",
  },
];

const hongKongVoice: VoiceDto = {
  id: "zh-HK-HiuMaanNeural",
  displayName: "Microsoft HiuMaan",
  locale: "zh-HK",
  gender: "Female",
};

const liaoningVoice: VoiceDto = {
  id: "zh-CN-liaoning-XiaobeiNeural",
  displayName: "Microsoft Xiaobei",
  locale: "zh-CN-liaoning",
  gender: "Female",
};

describe("Voice Catalog Pure Model (apps/web/src/voice-catalog.ts)", () => {
  describe("getLocaleOptions", () => {
    it("derives the all-option and unique locales, the interface's own first, with counts", () => {
      const options = getLocaleOptions(testVoices);
      expect(options[0]).toEqual({
        locale: "all",
        label: "全部地区 (5)",
        count: 5,
      });

      // 简体中文: zh-CN first, then the rest by pinyin of their names: 美国英语, 日语, 英国英语
      expect(options.slice(1)).toEqual([
        { locale: "zh-CN", label: "zh-CN (2)", count: 2 },
        { locale: "en-US", label: "en-US (1)", count: 1 },
        { locale: "ja-JP", label: "ja-JP (1)", count: 1 },
        { locale: "en-GB", label: "en-GB (1)", count: 1 },
      ]);
    });

    it("orders locales for each interface language: its own language first, then by name", () => {
      const order = (uiLocale: UiLocale) =>
        getLocaleOptions([...testVoices, hongKongVoice], uiLocale)
          .slice(1)
          .map((option) => option.locale);

      // The interface's locale, then the rest of its language, then everything else.
      expect(order("zh-CN").slice(0, 2)).toEqual(["zh-CN", "zh-HK"]);
      expect(order("zh-TW")[0]).toBe("zh-CN");
      // English has no exact locale, so all English locales lead, by name: American, British.
      expect(order("en")).toEqual(["en-US", "en-GB", "zh-CN", "zh-HK", "ja-JP"]);
      expect(order("ja")).toEqual(["ja-JP", "en-US", "en-GB", "zh-HK", "zh-CN"]);
    });

    it("handles empty voice catalog cleanly", () => {
      const options = getLocaleOptions([]);
      expect(options).toEqual([
        {
          locale: "all",
          label: "全部地区 (0)",
          count: 0,
        },
      ]);
    });
  });

  describe("matchesVoiceSearch", () => {
    const sampleVoice = testVoices[0]!; // Xiaoxiao (zh-CN, Female)

    it("returns true for empty query or whitespace", () => {
      expect(matchesVoiceSearch(sampleVoice, "")).toBe(true);
      expect(matchesVoiceSearch(sampleVoice, "   ")).toBe(true);
    });

    it("matches by displayName case-insensitively", () => {
      expect(matchesVoiceSearch(sampleVoice, "xiaoxiao")).toBe(true);
      expect(matchesVoiceSearch(sampleVoice, "XIAOXIAO")).toBe(true);
      expect(matchesVoiceSearch(sampleVoice, "microsoft")).toBe(true);
    });

    it("matches by voice id case-insensitively", () => {
      expect(matchesVoiceSearch(sampleVoice, "zh-cn-xiao")).toBe(true);
      expect(matchesVoiceSearch(sampleVoice, "NEURAL")).toBe(true);
    });

    it("matches by locale case-insensitively", () => {
      expect(matchesVoiceSearch(sampleVoice, "zh-cn")).toBe(true);
    });

    it("matches by gender case-insensitively", () => {
      expect(matchesVoiceSearch(sampleVoice, "female")).toBe(true);
      expect(matchesVoiceSearch(sampleVoice, "FEMALE")).toBe(true);
      expect(matchesVoiceSearch(testVoices[1]!, "male")).toBe(true);
    });

    it("returns false for non-matching queries", () => {
      expect(matchesVoiceSearch(sampleVoice, "nonexistent")).toBe(false);
      expect(matchesVoiceSearch(sampleVoice, "en-us")).toBe(false);
      expect(matchesVoiceSearch(sampleVoice, "日语")).toBe(false);
    });

    it("matches the locale's name in every interface language, whichever is active", () => {
      const nanami = testVoices[4]!;
      for (const query of ["日语", "日文", "日本語", "Japanese", "japan"]) {
        expect(matchesVoiceSearch(nanami, query, "zh-CN")).toBe(true);
        expect(matchesVoiceSearch(nanami, query, "en")).toBe(true);
      }
      expect(matchesVoiceSearch(sampleVoice, "中文", "ja")).toBe(true);
      expect(matchesVoiceSearch(sampleVoice, "Chinese")).toBe(true);
      expect(matchesVoiceSearch(testVoices[3]!, "英国英语")).toBe(true);
      expect(matchesVoiceSearch(testVoices[3]!, "British")).toBe(true);
    });

    it("matches what people call a dialect when its display name does not say it", () => {
      for (const query of ["粤语", "粵語", "广东话", "Cantonese", "広東語"]) {
        expect(matchesVoiceSearch(hongKongVoice, query)).toBe(true);
      }
      expect(matchesVoiceSearch(sampleVoice, "粤语")).toBe(false);
      expect(matchesVoiceSearch(sampleVoice, "普通话")).toBe(true);
      expect(matchesVoiceSearch(sampleVoice, "mandarin")).toBe(true);
      expect(matchesVoiceSearch(liaoningVoice, "东北话")).toBe(true);
      expect(matchesVoiceSearch(liaoningVoice, "辽宁")).toBe(true);
      expect(matchesVoiceSearch(liaoningVoice, "Liaoning")).toBe(true);
    });

    it("ignores full-width forms and case", () => {
      expect(matchesVoiceSearch(sampleVoice, "ＸＩＡＯＸＩＡＯ")).toBe(true);
      expect(matchesVoiceSearch(sampleVoice, "ＣＨＩＮＥＳＥ")).toBe(true);
      expect(matchesVoiceSearch(testVoices[4]!, "日本語 (日本)")).toBe(true);
    });
  });

  describe("filterVoices", () => {
    it("composes search, locale, and favoriteOnly with boolean AND", () => {
      const favorites = new Set(["zh-CN-XiaoxiaoNeural", "en-US-JennyNeural"]);

      // 1. Locale filter only
      const zhVoices = filterVoices(testVoices, {
        search: "",
        locale: "zh-CN",
        favoriteOnly: false,
        favoriteIds: favorites,
      });
      expect(zhVoices.map((v) => v.id)).toEqual(["zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural"]);

      // 2. Locale + Search
      const zhFemaleVoices = filterVoices(testVoices, {
        search: "female",
        locale: "zh-CN",
        favoriteOnly: false,
        favoriteIds: favorites,
      });
      expect(zhFemaleVoices.map((v) => v.id)).toEqual(["zh-CN-XiaoxiaoNeural"]);

      // 3. FavoriteOnly
      const favoriteVoices = filterVoices(testVoices, {
        search: "",
        locale: "all",
        favoriteOnly: true,
        favoriteIds: favorites,
      });
      expect(favoriteVoices.map((v) => v.id)).toEqual([
        "zh-CN-XiaoxiaoNeural",
        "en-US-JennyNeural",
      ]);

      // 4. FavoriteOnly + Locale + Search
      const favZhFemale = filterVoices(testVoices, {
        search: "xiao",
        locale: "zh-CN",
        favoriteOnly: true,
        favoriteIds: favorites,
      });
      expect(favZhFemale.map((v) => v.id)).toEqual(["zh-CN-XiaoxiaoNeural"]);
    });

    it("returns empty list when no voices match", () => {
      const result = filterVoices(testVoices, {
        search: "query-matching-nothing",
        locale: "all",
        favoriteOnly: false,
        favoriteIds: new Set(),
      });
      expect(result).toEqual([]);
    });
  });

  describe("getGroupedVoices", () => {
    it("places favorite voices first under '收藏' optgroup and does NOT duplicate them in locale groups", () => {
      const favorites = new Set(["zh-CN-XiaoxiaoNeural"]);
      const groups = getGroupedVoices(testVoices, favorites);

      // First group must be "收藏"
      expect(groups[0]!.label).toBe("收藏");
      expect(groups[0]!.voices.map((v) => v.id)).toEqual(["zh-CN-XiaoxiaoNeural"]);

      // Then locale groups in the locale filter's order: zh-CN, 美国英语, 日语, 英国英语
      const otherGroupLabels = groups.slice(1).map((g) => g.label);
      expect(otherGroupLabels).toEqual(["zh-CN", "en-US", "ja-JP", "en-GB"]);

      // zh-CN locale group must contain ONLY non-favorite voices (Yunxi), Xiaoxiao must not be duplicated
      const zhGroup = groups.find((g) => g.label === "zh-CN")!;
      expect(zhGroup.voices.map((v) => v.id)).toEqual(["zh-CN-YunxiNeural"]);
    });

    it("omits '收藏' optgroup when there are no favorites in filtered voices", () => {
      const groups = getGroupedVoices(testVoices, new Set());
      expect(groups.some((g) => g.label === "收藏")).toBe(false);
      expect(groups.map((g) => g.label)).toEqual(["zh-CN", "en-US", "ja-JP", "en-GB"]);
      expect(getGroupedVoices(testVoices, new Set(), "en").map((g) => g.label)).toEqual([
        "en-US",
        "en-GB",
        "zh-CN",
        "ja-JP",
      ]);
    });

    it("sorts favorites by locale -> displayName -> id", () => {
      const favorites = new Set(["zh-CN-XiaoxiaoNeural", "en-US-JennyNeural", "en-GB-SoniaNeural"]);
      const groups = getGroupedVoices(testVoices, favorites);
      const favGroup = groups[0]!;
      expect(favGroup.label).toBe("收藏");
      // Sorted by locale in the interface's order: zh-CN (Xiaoxiao), en-US (Jenny), en-GB (Sonia)
      expect(favGroup.voices.map((v) => v.id)).toEqual([
        "zh-CN-XiaoxiaoNeural",
        "en-US-JennyNeural",
        "en-GB-SoniaNeural",
      ]);
    });
  });

  describe("isVoiceVisible", () => {
    it("returns true when voice is present in filtered results", () => {
      expect(isVoiceVisible(testVoices, "zh-CN-XiaoxiaoNeural")).toBe(true);
    });

    it("returns false when voice is absent or empty", () => {
      expect(isVoiceVisible(testVoices, "absent-voice")).toBe(false);
      expect(isVoiceVisible(testVoices, "")).toBe(false);
    });
  });
});
