import { describe, it, expect } from "vitest";
import {
  parseSynthesisPlanHeaders,
  formatAudioBytes,
  formatGeneratingStatusText,
  MAX_TELEMETRY_HEADER_VALUE,
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
});
