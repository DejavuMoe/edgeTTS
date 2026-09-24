import { describe, it, expect } from "vitest";
import type { VoiceDto } from "@edgetts/shared";
import {
  getLocaleOptions,
  matchesVoiceSearch,
  filterVoices,
  getGroupedVoices,
  isVoiceVisible,
} from "../src/voice-catalog.js";

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

describe("Voice Catalog Pure Model (apps/web/src/voice-catalog.ts)", () => {
  describe("getLocaleOptions", () => {
    it("derives all-option and unique locales in lexical ascending order with correct counts", () => {
      const options = getLocaleOptions(testVoices);
      expect(options[0]).toEqual({
        locale: "all",
        label: "全部地区 (5)",
        count: 5,
      });

      // Expected sorted locales: en-GB, en-US, ja-JP, zh-CN
      expect(options.slice(1)).toEqual([
        { locale: "en-GB", label: "en-GB (1)", count: 1 },
        { locale: "en-US", label: "en-US (1)", count: 1 },
        { locale: "ja-JP", label: "ja-JP (1)", count: 1 },
        { locale: "zh-CN", label: "zh-CN (2)", count: 2 },
      ]);
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

      // Subsequent groups are sorted locales: en-GB, en-US, ja-JP, zh-CN
      const otherGroupLabels = groups.slice(1).map((g) => g.label);
      expect(otherGroupLabels).toEqual(["en-GB", "en-US", "ja-JP", "zh-CN"]);

      // zh-CN locale group must contain ONLY non-favorite voices (Yunxi), Xiaoxiao must not be duplicated
      const zhGroup = groups.find((g) => g.label === "zh-CN")!;
      expect(zhGroup.voices.map((v) => v.id)).toEqual(["zh-CN-YunxiNeural"]);
    });

    it("omits '收藏' optgroup when there are no favorites in filtered voices", () => {
      const groups = getGroupedVoices(testVoices, new Set());
      expect(groups.some((g) => g.label === "收藏")).toBe(false);
      expect(groups.map((g) => g.label)).toEqual(["en-GB", "en-US", "ja-JP", "zh-CN"]);
    });

    it("sorts favorites by locale -> displayName -> id", () => {
      const favorites = new Set(["zh-CN-XiaoxiaoNeural", "en-US-JennyNeural", "en-GB-SoniaNeural"]);
      const groups = getGroupedVoices(testVoices, favorites);
      const favGroup = groups[0]!;
      expect(favGroup.label).toBe("收藏");
      // Sorted by locale: en-GB (Sonia) -> en-US (Jenny) -> zh-CN (Xiaoxiao)
      expect(favGroup.voices.map((v) => v.id)).toEqual([
        "en-GB-SoniaNeural",
        "en-US-JennyNeural",
        "zh-CN-XiaoxiaoNeural",
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
