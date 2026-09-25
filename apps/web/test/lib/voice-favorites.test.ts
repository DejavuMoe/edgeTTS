import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  WORKBENCH_FAVORITES_KEY,
  MAX_FAVORITES_COUNT,
  MAX_VOICE_ID_LENGTH,
  validateFavoriteVoiceIds,
  loadFavoriteVoiceIds,
  saveFavoriteVoiceIds,
  toggleFavoriteVoiceId,
} from "../../src/lib/voice-favorites.js";

describe("Voice Favorites (apps/web/src/voice-favorites.ts)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe("Validation (validateFavoriteVoiceIds)", () => {
    it("returns empty array for null, undefined, primitive, or array input", () => {
      expect(validateFavoriteVoiceIds(null)).toEqual([]);
      expect(validateFavoriteVoiceIds(undefined)).toEqual([]);
      expect(validateFavoriteVoiceIds("bad")).toEqual([]);
      expect(validateFavoriteVoiceIds(123)).toEqual([]);
      expect(validateFavoriteVoiceIds([])).toEqual([]);
    });

    it("returns empty array when voiceIds is missing or not an array", () => {
      expect(validateFavoriteVoiceIds({})).toEqual([]);
      expect(validateFavoriteVoiceIds({ voiceIds: "not-an-array" })).toEqual([]);
      expect(validateFavoriteVoiceIds({ other: [1, 2, 3] })).toEqual([]);
    });

    it("accepts valid string array and trims items", () => {
      const input = {
        voiceIds: ["  zh-CN-XiaoxiaoNeural  ", "en-US-JennyNeural"],
      };
      expect(validateFavoriteVoiceIds(input)).toEqual([
        "zh-CN-XiaoxiaoNeural",
        "en-US-JennyNeural",
      ]);
    });

    it("filters out non-string, empty, and whitespace-only entries", () => {
      const input = {
        voiceIds: [123, null, undefined, {}, "", "   ", "valid-id", true],
      };
      expect(validateFavoriteVoiceIds(input)).toEqual(["valid-id"]);
    });

    it("deduplicates identical IDs", () => {
      const input = {
        voiceIds: ["id-1", "id-2", "id-1", "id-2", "id-3"],
      };
      expect(validateFavoriteVoiceIds(input)).toEqual(["id-1", "id-2", "id-3"]);
    });

    it("rejects or ignores voice IDs exceeding MAX_VOICE_ID_LENGTH", () => {
      const overlong = "a".repeat(MAX_VOICE_ID_LENGTH + 1);
      const valid = "a".repeat(MAX_VOICE_ID_LENGTH);
      const input = {
        voiceIds: [overlong, valid],
      };
      expect(validateFavoriteVoiceIds(input)).toEqual([valid]);
    });

    it("caps total favorite count at MAX_FAVORITES_COUNT (128)", () => {
      const ids: string[] = [];
      for (let i = 0; i < 200; i++) {
        ids.push(`voice-id-${i}`);
      }
      const result = validateFavoriteVoiceIds({ voiceIds: ids });
      expect(result.length).toBe(MAX_FAVORITES_COUNT);
      expect(result[0]).toBe("voice-id-0");
      expect(result[127]).toBe("voice-id-127");
    });
  });

  describe("Storage Operations (load / save)", () => {
    it("returns empty array when storage is empty", () => {
      expect(loadFavoriteVoiceIds()).toEqual([]);
    });

    it("loads valid favorites from storage", () => {
      window.localStorage.setItem(
        WORKBENCH_FAVORITES_KEY,
        JSON.stringify({ voiceIds: ["zh-CN-XiaoxiaoNeural", "en-US-JennyNeural"] }),
      );
      expect(loadFavoriteVoiceIds()).toEqual(["zh-CN-XiaoxiaoNeural", "en-US-JennyNeural"]);
    });

    it("gracefully returns empty array on malformed JSON", () => {
      window.localStorage.setItem(WORKBENCH_FAVORITES_KEY, "{ invalid json");
      expect(loadFavoriteVoiceIds()).toEqual([]);
    });

    it("gracefully returns empty array when storage throws SecurityError", () => {
      const mockStorage = {
        getItem: vi.fn(() => {
          throw new Error("SecurityError: Access is denied");
        }),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      };
      expect(loadFavoriteVoiceIds(mockStorage as unknown as Storage)).toEqual([]);
    });

    it("saves validated favorites to storage", () => {
      saveFavoriteVoiceIds(["zh-CN-YunxiNeural", "en-US-JennyNeural"]);
      const raw = window.localStorage.getItem(WORKBENCH_FAVORITES_KEY);
      expect(raw).toBeDefined();
      const parsed = JSON.parse(raw!);
      expect(parsed).toEqual({
        voiceIds: ["zh-CN-YunxiNeural", "en-US-JennyNeural"],
      });
    });

    it("gracefully ignores QuotaExceededError on save", () => {
      const mockStorage = {
        getItem: vi.fn(),
        setItem: vi.fn(() => {
          throw new Error("QuotaExceededError: storage full");
        }),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      };
      expect(() => {
        saveFavoriteVoiceIds(["voice-1"], mockStorage as unknown as Storage);
      }).not.toThrow();
    });

    it("persists voice IDs that may be absent from catalog without destructive deletion", () => {
      const missingVoiceId = "temporarily-unavailable-voice-id";
      saveFavoriteVoiceIds([missingVoiceId]);
      const loaded = loadFavoriteVoiceIds();
      expect(loaded).toContain(missingVoiceId);
    });
  });

  describe("Toggling Favorites (toggleFavoriteVoiceId)", () => {
    it("adds an ID if not already present", () => {
      const initial = ["voice-1", "voice-2"];
      const updated = toggleFavoriteVoiceId(initial, "voice-3");
      expect(updated).toEqual(["voice-1", "voice-2", "voice-3"]);
    });

    it("removes an ID if already present while preserving others", () => {
      const initial = ["voice-1", "voice-2", "voice-3"];
      const updated = toggleFavoriteVoiceId(initial, "voice-2");
      expect(updated).toEqual(["voice-1", "voice-3"]);
    });

    it("ignores empty or whitespace voiceId", () => {
      const initial = ["voice-1"];
      expect(toggleFavoriteVoiceId(initial, "")).toEqual(["voice-1"]);
      expect(toggleFavoriteVoiceId(initial, "   ")).toEqual(["voice-1"]);
    });

    it("does not add beyond MAX_FAVORITES_COUNT", () => {
      const fullList: string[] = [];
      for (let i = 0; i < MAX_FAVORITES_COUNT; i++) {
        fullList.push(`id-${i}`);
      }
      const updated = toggleFavoriteVoiceId(fullList, "overflow-id");
      expect(updated.length).toBe(MAX_FAVORITES_COUNT);
      expect(updated).not.toContain("overflow-id");
    });
  });
});
