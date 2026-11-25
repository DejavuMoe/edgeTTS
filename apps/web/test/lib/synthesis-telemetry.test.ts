import { describe, it, expect } from "vitest";
import { translate } from "../../src/i18n.js";
import { formatMediaTime } from "../../src/lib/media-time.js";
import {
  parseSynthesisPlanHeaders,
  estimateArrivedPercent,
  formatAudioBytes,
  formatGeneratingBytesText,
  formatGeneratingPhaseText,
  formatGeneratingProgressText,
  formatGeneratingStatusText,
  MAX_TELEMETRY_HEADER_VALUE,
  STATUS_SEPARATOR,
} from "../../src/lib/synthesis-telemetry.js";

describe("Synthesis Telemetry", () => {
  describe("parseSynthesisPlanHeaders", () => {
    it("parses valid positive integer headers from Headers object", () => {
      const headers = new Headers();
      headers.set("X-EdgeTTS-Segment-Count", "12");
      headers.set("X-EdgeTTS-Segment-Max-Code-Points", "300");

      const plan = parseSynthesisPlanHeaders(headers);
      expect(plan.segmentCount).toBe(12);
      expect(plan.maxSegmentCodePoints).toBe(300);
    });

    it("parses headers case-insensitively from plain Record object", () => {
      const record = {
        "x-edgetts-segment-count": "5",
        "X-EDGETTS-SEGMENT-MAX-CODE-POINTS": "250",
      };

      const plan = parseSynthesisPlanHeaders(record);
      expect(plan.segmentCount).toBe(5);
      expect(plan.maxSegmentCodePoints).toBe(250);
    });

    it("returns null for missing headers or empty input", () => {
      expect(parseSynthesisPlanHeaders(null)).toEqual({
        segmentCount: null,
        maxSegmentCodePoints: null,
      });
      expect(parseSynthesisPlanHeaders(undefined)).toEqual({
        segmentCount: null,
        maxSegmentCodePoints: null,
      });
      expect(parseSynthesisPlanHeaders(new Headers())).toEqual({
        segmentCount: null,
        maxSegmentCodePoints: null,
      });
      expect(parseSynthesisPlanHeaders({})).toEqual({
        segmentCount: null,
        maxSegmentCodePoints: null,
      });
    });

    it("rejects zero value and returns null", () => {
      const headers = new Headers({
        "X-EdgeTTS-Segment-Count": "0",
        "X-EdgeTTS-Segment-Max-Code-Points": "0",
      });
      const plan = parseSynthesisPlanHeaders(headers);
      expect(plan.segmentCount).toBeNull();
      expect(plan.maxSegmentCodePoints).toBeNull();
    });

    it("rejects negative numbers and returns null", () => {
      const headers = new Headers({
        "X-EdgeTTS-Segment-Count": "-1",
        "X-EdgeTTS-Segment-Max-Code-Points": "-300",
      });
      const plan = parseSynthesisPlanHeaders(headers);
      expect(plan.segmentCount).toBeNull();
      expect(plan.maxSegmentCodePoints).toBeNull();
    });

    it("rejects decimal numbers and returns null", () => {
      const headers = new Headers({
        "X-EdgeTTS-Segment-Count": "12.5",
        "X-EdgeTTS-Segment-Max-Code-Points": "300.0",
      });
      const plan = parseSynthesisPlanHeaders(headers);
      expect(plan.segmentCount).toBeNull();
      expect(plan.maxSegmentCodePoints).toBeNull();
    });

    it("rejects non-numeric garbage and returns null", () => {
      const headers = new Headers({
        "X-EdgeTTS-Segment-Count": "12abc",
        "X-EdgeTTS-Segment-Max-Code-Points": "NaN",
      });
      const plan = parseSynthesisPlanHeaders(headers);
      expect(plan.segmentCount).toBeNull();
      expect(plan.maxSegmentCodePoints).toBeNull();
    });

    it("rejects values exceeding MAX_TELEMETRY_HEADER_VALUE (20,000)", () => {
      const headers = new Headers({
        "X-EdgeTTS-Segment-Count": "20001",
        "X-EdgeTTS-Segment-Max-Code-Points": "999999",
      });
      const plan = parseSynthesisPlanHeaders(headers);
      expect(plan.segmentCount).toBeNull();
      expect(plan.maxSegmentCodePoints).toBeNull();
    });

    it("accepts boundary value exactly at MAX_TELEMETRY_HEADER_VALUE", () => {
      const headers = new Headers({
        "X-EdgeTTS-Segment-Count": String(MAX_TELEMETRY_HEADER_VALUE),
        "X-EdgeTTS-Segment-Max-Code-Points": String(MAX_TELEMETRY_HEADER_VALUE),
      });
      const plan = parseSynthesisPlanHeaders(headers);
      expect(plan.segmentCount).toBe(MAX_TELEMETRY_HEADER_VALUE);
      expect(plan.maxSegmentCodePoints).toBe(MAX_TELEMETRY_HEADER_VALUE);
    });

    it("handles partial validity when only one header is valid", () => {
      const headers = new Headers({
        "X-EdgeTTS-Segment-Count": "7",
        "X-EdgeTTS-Segment-Max-Code-Points": "invalid",
      });
      const plan = parseSynthesisPlanHeaders(headers);
      expect(plan.segmentCount).toBe(7);
      expect(plan.maxSegmentCodePoints).toBeNull();
    });
  });

  describe("formatAudioBytes", () => {
    it("formats 0 bytes as '0 B'", () => {
      expect(formatAudioBytes(0)).toBe("0 B");
    });

    it("formats negative, NaN, and non-finite values safely as '0 B'", () => {
      expect(formatAudioBytes(-500)).toBe("0 B");
      expect(formatAudioBytes(Number.NaN)).toBe("0 B");
      expect(formatAudioBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
    });

    it("formats bytes under 1024 as integer B", () => {
      expect(formatAudioBytes(1)).toBe("1 B");
      expect(formatAudioBytes(512)).toBe("512 B");
      expect(formatAudioBytes(999)).toBe("999 B");
      expect(formatAudioBytes(1023)).toBe("1023 B");
    });

    it("formats bytes in KiB range with at most one decimal place", () => {
      expect(formatAudioBytes(1024)).toBe("1.0 KiB");
      expect(formatAudioBytes(1536)).toBe("1.5 KiB");
      expect(formatAudioBytes(43315)).toBe("42.3 KiB");
      expect(formatAudioBytes(127795)).toBe("124.8 KiB");
      expect(formatAudioBytes(1024 * 1024 - 1)).toBe("1024.0 KiB");
    });

    it("formats bytes in MiB range with at most one decimal place", () => {
      expect(formatAudioBytes(1024 * 1024)).toBe("1.0 MiB");
      expect(formatAudioBytes(1.5 * 1024 * 1024)).toBe("1.5 MiB");
      expect(formatAudioBytes(1887436)).toBe("1.8 MiB");
      expect(formatAudioBytes(10 * 1024 * 1024)).toBe("10.0 MiB");
    });
  });

  describe("formatGeneratingStatusText", () => {
    it("formats requesting phase as '正在等待语音服务…'", () => {
      const text = formatGeneratingStatusText({
        phase: "requesting",
        segmentCount: null,
        bytesReceived: 0,
      });
      expect(text).toBe("正在等待语音服务…");
    });

    it("formats streaming phase with segment count and bytes", () => {
      const text = formatGeneratingStatusText({
        phase: "streaming",
        segmentCount: 12,
        bytesReceived: 127795,
      });
      expect(text).toBe("正在流式接收音频 · 共 12 段 · 124.8 KiB");
    });

    it("formats streaming phase when segment count is absent", () => {
      const text = formatGeneratingStatusText({
        phase: "streaming",
        segmentCount: null,
        bytesReceived: 86016,
      });
      expect(text).toBe("正在流式接收音频 · 84.0 KiB");
    });

    it("formats streaming phase when bytes received is 0", () => {
      const textWithCount = formatGeneratingStatusText({
        phase: "streaming",
        segmentCount: 5,
        bytesReceived: 0,
      });
      expect(textWithCount).toBe("正在流式接收音频 · 共 5 段");

      const textWithoutCount = formatGeneratingStatusText({
        phase: "streaming",
        segmentCount: null,
        bytesReceived: 0,
      });
      expect(textWithoutCount).toBe("正在流式接收音频");
    });
  });

  describe("formatGeneratingPhaseText and formatGeneratingBytesText", () => {
    it("keeps the byte count out of the phase that is announced", () => {
      const streaming = { phase: "streaming" as const, segmentCount: 12, bytesReceived: 127795 };
      expect(formatGeneratingPhaseText(streaming)).toBe("正在流式接收音频 · 共 12 段");
      expect(formatGeneratingBytesText(streaming)).toBe("124.8 KiB");
      expect(formatGeneratingPhaseText(streaming, "en")).not.toContain("KiB");
    });

    it("has no byte count before streaming starts or before the first byte", () => {
      expect(
        formatGeneratingBytesText({ phase: "requesting", segmentCount: 3, bytesReceived: 4096 }),
      ).toBeNull();
      expect(
        formatGeneratingBytesText({ phase: "streaming", segmentCount: 3, bytesReceived: 0 }),
      ).toBeNull();
    });

    it("joins to the same status line that is shown", () => {
      const samples = [
        { phase: "requesting" as const, segmentCount: null, bytesReceived: 0 },
        { phase: "requesting" as const, segmentCount: 4, bytesReceived: 2048 },
        { phase: "streaming" as const, segmentCount: null, bytesReceived: 86016 },
        { phase: "streaming" as const, segmentCount: 5, bytesReceived: 0 },
      ];
      for (const sample of samples) {
        const bytes = formatGeneratingBytesText(sample);
        expect(formatGeneratingStatusText(sample)).toBe(
          [formatGeneratingPhaseText(sample), ...(bytes ? [bytes] : [])].join(STATUS_SEPARATOR),
        );
      }
    });
  });

  describe("formatGeneratingProgressText", () => {
    // 60,000 bytes of standard-quality audio is 10 seconds.
    const streaming = {
      phase: "streaming" as const,
      segmentCount: 3,
      bytesReceived: 60_000,
      bytesPerSecond: 6000,
    };

    it("shows the audio received as time, with its share of the expected length", () => {
      expect(formatGeneratingProgressText({ ...streaming, expectedSeconds: 40 })).toBe(
        "已接收 0:10（约 25%）",
      );
      expect(formatGeneratingProgressText({ ...streaming, bytesPerSecond: 12000 })).toBe(
        "已接收 0:05",
      );
    });

    it("never shows a take still arriving as complete, even past its estimate", () => {
      expect(formatGeneratingProgressText({ ...streaming, expectedSeconds: 10 })).toBe(
        "已接收 0:10（约 99%）",
      );
      expect(formatGeneratingProgressText({ ...streaming, expectedSeconds: 4 })).toBe(
        "已接收 0:10（约 99%）",
      );
    });

    it("falls back to the byte count when the bitrate is unknown", () => {
      expect(formatGeneratingProgressText({ ...streaming, bytesPerSecond: null })).toBe(
        formatAudioBytes(60_000),
      );
      expect(
        formatGeneratingProgressText({ phase: "streaming", segmentCount: 3, bytesReceived: 4096 }),
      ).toBe("4.0 KiB");
    });

    it("has nothing to show before streaming starts or before the first byte", () => {
      expect(
        formatGeneratingProgressText({ ...streaming, phase: "requesting", expectedSeconds: 40 }),
      ).toBeNull();
      expect(formatGeneratingProgressText({ ...streaming, bytesReceived: 0 })).toBeNull();
    });

    it("joins the status line after the phase", () => {
      const sample = { ...streaming, expectedSeconds: 40 };
      expect(formatGeneratingStatusText(sample)).toBe(
        `正在流式接收音频 · 共 3 段${STATUS_SEPARATOR}已接收 0:10（约 25%）`,
      );
    });

    it("is written in each interface language", () => {
      for (const locale of ["zh-CN", "zh-TW", "en", "ja"] as const) {
        expect(formatGeneratingProgressText({ ...streaming, expectedSeconds: 40 }, locale)).toBe(
          translate("已接收 {time}（约 {percent}%）", locale, { time: "0:10", percent: 25 }),
        );
      }
    });
  });

  describe("estimateArrivedPercent", () => {
    it("rounds down, and gives nothing without an estimate", () => {
      expect(estimateArrivedPercent(9.99, 10)).toBe(99);
      expect(estimateArrivedPercent(0.5, 10)).toBe(5);
      expect(estimateArrivedPercent(5, null)).toBeNull();
      expect(estimateArrivedPercent(5, 0)).toBeNull();
      expect(estimateArrivedPercent(5, Number.POSITIVE_INFINITY)).toBeNull();
    });
  });

  describe("formatMediaTime", () => {
    it("writes minutes and seconds, and dashes when unknown", () => {
      expect(formatMediaTime(0)).toBe("0:00");
      expect(formatMediaTime(65.9)).toBe("1:05");
      expect(formatMediaTime(3725)).toBe("62:05");
      expect(formatMediaTime(Number.NaN)).toBe("--:--");
      expect(formatMediaTime(Number.POSITIVE_INFINITY)).toBe("--:--");
      expect(formatMediaTime(-1)).toBe("--:--");
    });
  });
});
