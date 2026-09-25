import { describe, it, expect, beforeEach, vi } from "vitest";
import type { VoiceDto } from "@edgetts/shared";
import {
  WORKBENCH_PREFERENCES_KEY,
  DEFAULT_WORKBENCH_PREFERENCES,
  validateWorkbenchPreferences,
  loadWorkbenchPreferences,
  saveWorkbenchPreferences,
  resolveEffectiveVoiceId,
  type WorkbenchPreferencesV1,
} from "../../src/lib/preferences.js";

const mockVoices: readonly VoiceDto[] = [
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
];

describe("Workbench Preferences (apps/web/src/preferences.ts)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe("Validation (validateWorkbenchPreferences)", () => {
    it("returns defaults when input is null, undefined, string, or array", () => {
      expect(validateWorkbenchPreferences(null)).toEqual(DEFAULT_WORKBENCH_PREFERENCES);
      expect(validateWorkbenchPreferences(undefined)).toEqual(DEFAULT_WORKBENCH_PREFERENCES);
      expect(validateWorkbenchPreferences("invalid")).toEqual(DEFAULT_WORKBENCH_PREFERENCES);
      expect(validateWorkbenchPreferences([1, 2, 3])).toEqual(DEFAULT_WORKBENCH_PREFERENCES);
      expect(validateWorkbenchPreferences(123)).toEqual(DEFAULT_WORKBENCH_PREFERENCES);
    });

    it("accepts valid preferences object", () => {
      const valid: WorkbenchPreferencesV1 = {
        voiceId: "zh-CN-YunxiNeural",
        quality: "high",
        speed: 1.25,
        pitchSemitones: -4,
        volume: 0.75,
      };
      expect(validateWorkbenchPreferences(valid)).toEqual(valid);
    });

    it("rejects invalid or missing voiceId and defaults to empty string", () => {
      expect(validateWorkbenchPreferences({ voiceId: "" }).voiceId).toBe("");
      expect(validateWorkbenchPreferences({ voiceId: "   " }).voiceId).toBe("");
      expect(validateWorkbenchPreferences({ voiceId: 12345 }).voiceId).toBe("");
      expect(validateWorkbenchPreferences({ voiceId: {} }).voiceId).toBe("");
      expect(validateWorkbenchPreferences({ voiceId: "  en-US-JennyNeural  " }).voiceId).toBe(
        "en-US-JennyNeural",
      );
    });

    it("rejects invalid quality values and defaults to standard", () => {
      expect(validateWorkbenchPreferences({ quality: "ultra" }).quality).toBe("standard");
      expect(validateWorkbenchPreferences({ quality: "low" }).quality).toBe("standard");
      expect(validateWorkbenchPreferences({ quality: 123 }).quality).toBe("standard");
      expect(validateWorkbenchPreferences({ quality: "high" }).quality).toBe("high");
      expect(validateWorkbenchPreferences({ quality: "standard" }).quality).toBe("standard");
    });

    it("rejects NaN, Infinity, string numbers, and out-of-range speed", () => {
      expect(validateWorkbenchPreferences({ speed: "1.5" }).speed).toBe(1.0);
      expect(validateWorkbenchPreferences({ speed: Number.NaN }).speed).toBe(1.0);
      expect(validateWorkbenchPreferences({ speed: Number.POSITIVE_INFINITY }).speed).toBe(1.0);
      expect(validateWorkbenchPreferences({ speed: 0.49 }).speed).toBe(1.0);
      expect(validateWorkbenchPreferences({ speed: 2.01 }).speed).toBe(1.0);
      expect(validateWorkbenchPreferences({ speed: 0.5 }).speed).toBe(0.5);
      expect(validateWorkbenchPreferences({ speed: 2.0 }).speed).toBe(2.0);
      expect(validateWorkbenchPreferences({ speed: 1.5 }).speed).toBe(1.5);
    });

    it("rejects non-integer, NaN, and out-of-range pitchSemitones", () => {
      expect(validateWorkbenchPreferences({ pitchSemitones: 1.5 }).pitchSemitones).toBe(0);
      expect(validateWorkbenchPreferences({ pitchSemitones: "2" }).pitchSemitones).toBe(0);
      expect(validateWorkbenchPreferences({ pitchSemitones: Number.NaN }).pitchSemitones).toBe(0);
      expect(validateWorkbenchPreferences({ pitchSemitones: -13 }).pitchSemitones).toBe(0);
      expect(validateWorkbenchPreferences({ pitchSemitones: 13 }).pitchSemitones).toBe(0);
      expect(validateWorkbenchPreferences({ pitchSemitones: -12 }).pitchSemitones).toBe(-12);
      expect(validateWorkbenchPreferences({ pitchSemitones: 12 }).pitchSemitones).toBe(12);
      expect(validateWorkbenchPreferences({ pitchSemitones: 5 }).pitchSemitones).toBe(5);
    });

    it("rejects NaN, string numbers, and out-of-range volume", () => {
      expect(validateWorkbenchPreferences({ volume: "0.8" }).volume).toBe(1.0);
      expect(validateWorkbenchPreferences({ volume: Number.NaN }).volume).toBe(1.0);
      expect(validateWorkbenchPreferences({ volume: -0.01 }).volume).toBe(1.0);
      expect(validateWorkbenchPreferences({ volume: 1.01 }).volume).toBe(1.0);
      expect(validateWorkbenchPreferences({ volume: 0.0 }).volume).toBe(0.0);
      expect(validateWorkbenchPreferences({ volume: 1.0 }).volume).toBe(1.0);
      expect(validateWorkbenchPreferences({ volume: 0.65 }).volume).toBe(0.65);
    });

    it("strips unexpected fields and enforces strict schema boundary", () => {
      const untrusted = {
        voiceId: "zh-CN-XiaoxiaoNeural",
        quality: "standard",
        speed: 1.0,
        pitchSemitones: 0,
        volume: 1.0,
        apiKey: "secret-token",
        input: "untrusted text",
        blob: "audio-blob",
        extra: { nested: true },
      };

      const result = validateWorkbenchPreferences(untrusted);
      expect(result).toEqual({
        voiceId: "zh-CN-XiaoxiaoNeural",
        quality: "standard",
        speed: 1.0,
        pitchSemitones: 0,
        volume: 1.0,
      });
      expect("apiKey" in result).toBe(false);
      expect("input" in result).toBe(false);
      expect("blob" in result).toBe(false);
    });
  });

  describe("Storage Operations (load / save)", () => {
    it("loads default preferences when storage is empty", () => {
      const prefs = loadWorkbenchPreferences();
      expect(prefs).toEqual(DEFAULT_WORKBENCH_PREFERENCES);
    });

    it("loads valid preferences from storage", () => {
      const saved: WorkbenchPreferencesV1 = {
        voiceId: "en-US-JennyNeural",
        quality: "high",
        speed: 1.2,
        pitchSemitones: -2,
        volume: 0.9,
      };
      window.localStorage.setItem(WORKBENCH_PREFERENCES_KEY, JSON.stringify(saved));

      const loaded = loadWorkbenchPreferences();
      expect(loaded).toEqual(saved);
    });

    it("gracefully recovers with defaults when storage contains malformed JSON", () => {
      window.localStorage.setItem(WORKBENCH_PREFERENCES_KEY, "{ bad json");
      const loaded = loadWorkbenchPreferences();
      expect(loaded).toEqual(DEFAULT_WORKBENCH_PREFERENCES);
    });

    it("gracefully recovers with defaults when storage throws SecurityError", () => {
      const mockStorage = {
        getItem: vi.fn(() => {
          throw new Error("SecurityError: Access denied");
        }),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      };

      const loaded = loadWorkbenchPreferences(mockStorage as unknown as Storage);
      expect(loaded).toEqual(DEFAULT_WORKBENCH_PREFERENCES);
    });

    it("saves validated preferences to storage", () => {
      saveWorkbenchPreferences({
        voiceId: "zh-CN-YunxiNeural",
        quality: "high",
        speed: 1.5,
        pitchSemitones: 2,
        volume: 0.8,
      });

      const raw = window.localStorage.getItem(WORKBENCH_PREFERENCES_KEY);
      expect(raw).toBeDefined();
      const parsed = JSON.parse(raw!);
      expect(parsed).toEqual({
        voiceId: "zh-CN-YunxiNeural",
        quality: "high",
        speed: 1.5,
        pitchSemitones: 2,
        volume: 0.8,
      });
    });

    it("does not crash when saveWorkbenchPreferences throws QuotaExceededError", () => {
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
        saveWorkbenchPreferences(
          {
            voiceId: "zh-CN-YunxiNeural",
            speed: 1.0,
          },
          mockStorage as unknown as Storage,
        );
      }).not.toThrow();
    });

    it("privacy invariant: sensitive fields are never written to storage", () => {
      // Pass an object with sensitive fields (bypassing TS types at runtime)
      const dirty = {
        voiceId: "zh-CN-YunxiNeural",
        quality: "standard" as const,
        speed: 1.0,
        pitchSemitones: 0,
        volume: 1.0,
        apiKey: "SUPER_SECRET_KEY_12345",
        input: "Sensitive text that must not be stored",
        authKeyInput: "AUTH_INPUT_67890",
      };

      saveWorkbenchPreferences(dirty as unknown as Partial<WorkbenchPreferencesV1>);

      const raw = window.localStorage.getItem(WORKBENCH_PREFERENCES_KEY)!;
      expect(raw).not.toContain("SUPER_SECRET_KEY_12345");
      expect(raw).not.toContain("Sensitive text that must not be stored");
      expect(raw).not.toContain("AUTH_INPUT_67890");
      expect(raw).not.toContain("apiKey");
      expect(raw).not.toContain("authKeyInput");
    });
  });

  describe("Preferred Voice Restoration (resolveEffectiveVoiceId)", () => {
    it("restores preferred voice if present in voice list", () => {
      const result = resolveEffectiveVoiceId(mockVoices, "en-US-JennyNeural");
      expect(result).toBe("en-US-JennyNeural");
    });

    it("falls back to Xiaoxiao when preferred voice is absent from voice list", () => {
      const result = resolveEffectiveVoiceId(mockVoices, "non-existent-voice");
      expect(result).toBe("zh-CN-XiaoxiaoNeural");
    });

    it("falls back to any zh-CN voice when preferred voice and Xiaoxiao are absent", () => {
      const nonXiaoxiaoVoices: readonly VoiceDto[] = [
        { id: "zh-CN-YunxiNeural", displayName: "Yunxi", locale: "zh-CN", gender: "Male" },
        { id: "en-US-JennyNeural", displayName: "Jenny", locale: "en-US", gender: "Female" },
      ];
      const result = resolveEffectiveVoiceId(nonXiaoxiaoVoices, "deleted-voice");
      expect(result).toBe("zh-CN-YunxiNeural");
    });

    it("falls back to first available voice when no zh-CN voice exists", () => {
      const nonZhVoices: readonly VoiceDto[] = [
        { id: "en-US-JennyNeural", displayName: "Jenny", locale: "en-US", gender: "Female" },
        { id: "ja-JP-NanamiNeural", displayName: "Nanami", locale: "ja-JP", gender: "Female" },
      ];
      const result = resolveEffectiveVoiceId(nonZhVoices, "deleted-voice");
      expect(result).toBe("en-US-JennyNeural");
    });

    it("returns empty string when voice list is empty", () => {
      expect(resolveEffectiveVoiceId([], "any-voice")).toBe("");
      expect(resolveEffectiveVoiceId([])).toBe("");
    });
  });
});
