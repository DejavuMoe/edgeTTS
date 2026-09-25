import { describe, it, expect } from "vitest";
import {
  sanitizeVoiceSlug,
  formatTimestampSlug,
  formatCompletedAt,
  buildDownloadFilename,
  createCompletedResultMeta,
  formatResultMetadataDisplay,
  type GenerationSnapshot,
} from "../../src/lib/result-metadata.js";

describe("Download & Result Metadata (apps/web/src/result-metadata.ts)", () => {
  const testDate = new Date(2026, 8, 14, 15, 45, 30); // 2026-09-14 15:45:30 local

  describe("sanitizeVoiceSlug", () => {
    it("preserves safe alphanumeric characters, dots, underscores, and hyphens", () => {
      expect(sanitizeVoiceSlug("zh-CN-XiaoxiaoNeural")).toBe("zh-CN-XiaoxiaoNeural");
      expect(sanitizeVoiceSlug("en_US.Standard-A")).toBe("en_US.Standard-A");
    });

    it("replaces path traversal characters and directory separators with hyphens", () => {
      expect(sanitizeVoiceSlug("../../etc/passwd")).toBe("..-..-etc-passwd");
      expect(sanitizeVoiceSlug("voice/sub/id")).toBe("voice-sub-id");
      expect(sanitizeVoiceSlug("voice\\win\\id")).toBe("voice-win-id");
    });

    it("replaces colons, spaces, and special symbols with hyphens and collapses duplicates", () => {
      expect(sanitizeVoiceSlug("voice:123  custom::voice")).toBe("voice-123-custom-voice");
      expect(sanitizeVoiceSlug("###special@@@voice$$$")).toBe("special-voice");
    });

    it("strips leading and trailing hyphens", () => {
      expect(sanitizeVoiceSlug("-leading-trailing-")).toBe("leading-trailing");
      expect(sanitizeVoiceSlug("---multiple---")).toBe("multiple");
    });

    it("bounds excessively long voice IDs to <= 80 characters", () => {
      const veryLong = "a".repeat(100);
      const slug = sanitizeVoiceSlug(veryLong);
      expect(slug.length).toBe(80);
      expect(slug).toBe("a".repeat(80));
    });

    it("falls back to 'voice' when slug is completely stripped", () => {
      expect(sanitizeVoiceSlug("///:::;;;")).toBe("voice");
      expect(sanitizeVoiceSlug("")).toBe("voice");
      expect(sanitizeVoiceSlug("   ")).toBe("voice");
    });
  });

  describe("formatTimestampSlug & formatCompletedAt", () => {
    it("formats date into YYYYMMDD-HHmmss timestamp slug", () => {
      const slug = formatTimestampSlug(testDate);
      expect(slug).toBe("20260914-154530");
    });

    it("formats epoch milliseconds deterministically", () => {
      const slug = formatTimestampSlug(testDate.getTime());
      expect(slug).toBe("20260914-154530");
    });

    it("formats human-readable date for metadata UI", () => {
      const formatted = formatCompletedAt(testDate);
      expect(formatted).toBe("2026-09-14 15:45");
    });
  });

  describe("buildDownloadFilename", () => {
    it("generates descriptive filename matching format edgetts_<voice>_<quality>_<timestamp>.mp3", () => {
      const filename = buildDownloadFilename("zh-CN-XiaoxiaoNeural", "standard", testDate);
      expect(filename).toBe("edgetts_zh-CN-XiaoxiaoNeural_standard_20260914-154530.mp3");
    });

    it("supports high quality slug", () => {
      const filename = buildDownloadFilename("en-US-JennyNeural", "high", testDate);
      expect(filename).toBe("edgetts_en-US-JennyNeural_high_20260914-154530.mp3");
    });

    it("always ends with .mp3", () => {
      const filename = buildDownloadFilename("any-voice", "standard", testDate);
      expect(filename.endsWith(".mp3")).toBe(true);
    });

    it("does not contain raw input text, secret keys, or path separators", () => {
      const dirtyVoice = "voice/with/paths/and:colons";
      const filename = buildDownloadFilename(dirtyVoice, "standard", testDate);

      expect(filename).not.toContain("/");
      expect(filename).not.toContain("\\");
      expect(filename).not.toContain(":");
      expect(filename).toBe("edgetts_voice-with-paths-and-colons_standard_20260914-154530.mp3");
    });
  });

  describe("createCompletedResultMeta & formatResultMetadataDisplay", () => {
    it("binds snapshot fields, timestamp, and filename into immutable completed result", () => {
      const snapshot: GenerationSnapshot = {
        voiceId: "zh-CN-XiaoxiaoNeural",
        voiceDisplayName: "晓晓",
        quality: "standard",
        speed: 1.0,
        pitchSemitones: 0,
        volume: 1.0,
      };

      const meta = createCompletedResultMeta(snapshot, testDate);
      expect(meta.voiceId).toBe("zh-CN-XiaoxiaoNeural");
      expect(meta.voiceDisplayName).toBe("晓晓");
      expect(meta.quality).toBe("standard");
      expect(meta.speed).toBe(1.0);
      expect(meta.pitchSemitones).toBe(0);
      expect(meta.volume).toBe(1.0);
      expect(meta.completedAt).toBe(testDate.getTime());
      expect(meta.filename).toBe("edgetts_zh-CN-XiaoxiaoNeural_standard_20260914-154530.mp3");
    });

    it("formats metadata for UI display cleanly with default prosody", () => {
      const snapshot: GenerationSnapshot = {
        voiceId: "zh-CN-XiaoxiaoNeural",
        voiceDisplayName: "晓晓",
        quality: "standard",
        speed: 1.0,
        pitchSemitones: 0,
        volume: 1.0,
      };

      const meta = createCompletedResultMeta(snapshot, testDate);
      const text = formatResultMetadataDisplay(meta);
      expect(text).toBe("晓晓 · zh-CN-XiaoxiaoNeural · 标准 · 1.00× · 2026-09-14 15:45");
    });

    it("formats metadata for UI display with custom prosody (pitch & volume)", () => {
      const snapshot: GenerationSnapshot = {
        voiceId: "en-US-JennyNeural",
        voiceDisplayName: "Microsoft Jenny",
        quality: "high",
        speed: 1.25,
        pitchSemitones: 3,
        volume: 0.8,
      };

      const meta = createCompletedResultMeta(snapshot, testDate);
      const text = formatResultMetadataDisplay(meta);
      expect(text).toBe(
        "Microsoft Jenny · en-US-JennyNeural · 高品质 · 1.25× · +3半音 · 80%音量 · 2026-09-14 15:45",
      );
    });

    it("formats negative pitch semitones correctly", () => {
      const snapshot: GenerationSnapshot = {
        voiceId: "en-US-JennyNeural",
        voiceDisplayName: "Microsoft Jenny",
        quality: "standard",
        speed: 1.0,
        pitchSemitones: -4,
        volume: 1.0,
      };

      const meta = createCompletedResultMeta(snapshot, testDate);
      const text = formatResultMetadataDisplay(meta);
      expect(text).toBe(
        "Microsoft Jenny · en-US-JennyNeural · 标准 · 1.00× · -4半音 · 2026-09-14 15:45",
      );
    });

    it("formats telemetry metadata (segmentCount and audioBytes) correctly", () => {
      const snapshot: GenerationSnapshot = {
        voiceId: "zh-CN-XiaoxiaoNeural",
        voiceDisplayName: "晓晓",
        quality: "standard",
        speed: 1.0,
        pitchSemitones: 0,
        volume: 1.0,
        segmentCount: 12,
        audioBytes: 1887436,
      };

      const meta = createCompletedResultMeta(snapshot, testDate);
      const text = formatResultMetadataDisplay(meta);
      expect(text).toBe(
        "晓晓 · zh-CN-XiaoxiaoNeural · 标准 · 1.00× · 12 段 · 1.8 MiB · 2026-09-14 15:45",
      );
    });

    it("formats partial telemetry metadata when only segmentCount or audioBytes is present", () => {
      const snapshotCountOnly: GenerationSnapshot = {
        voiceId: "zh-CN-XiaoxiaoNeural",
        voiceDisplayName: "晓晓",
        quality: "high",
        speed: 1.0,
        pitchSemitones: 0,
        volume: 1.0,
        segmentCount: 3,
      };
      const metaCount = createCompletedResultMeta(snapshotCountOnly, testDate);
      expect(formatResultMetadataDisplay(metaCount)).toBe(
        "晓晓 · zh-CN-XiaoxiaoNeural · 高品质 · 1.00× · 3 段 · 2026-09-14 15:45",
      );

      const snapshotBytesOnly: GenerationSnapshot = {
        voiceId: "zh-CN-XiaoxiaoNeural",
        voiceDisplayName: "晓晓",
        quality: "standard",
        speed: 1.0,
        pitchSemitones: 0,
        volume: 1.0,
        audioBytes: 512,
      };
      const metaBytes = createCompletedResultMeta(snapshotBytesOnly, testDate);
      expect(formatResultMetadataDisplay(metaBytes)).toBe(
        "晓晓 · zh-CN-XiaoxiaoNeural · 标准 · 1.00× · 512 B · 2026-09-14 15:45",
      );
    });
  });
});
