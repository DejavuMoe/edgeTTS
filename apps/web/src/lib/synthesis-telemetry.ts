import { translate, type UiLocale } from "../i18n.js";
/**
 * Telemetry and metadata utilities for EdgeTTS speech synthesis.
 */

export interface SynthesisPlanMetadata {
  readonly segmentCount: number | null;
  readonly maxSegmentCodePoints: number | null;
}

export interface GenerationTelemetryState {
  readonly phase: "requesting" | "streaming";
  readonly segmentCount: number | null;
  readonly maxSegmentCodePoints: number | null;
  readonly bytesReceived: number;
}

/**
 * Maximum reasonable ceiling for defensive parsing of segment telemetry headers.
 */
export const MAX_TELEMETRY_HEADER_VALUE = 20_000;

/**
 * Defensively parses an integer header value.
 * Requires:
 * - non-null / non-empty string
 * - strict decimal positive integer format (/^[1-9]\d*$/)
 * - Number.isSafeInteger
 * - > 0 and <= 20,000
 * Otherwise returns null.
 */
function parsePositiveIntegerHeader(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_TELEMETRY_HEADER_VALUE) {
    return null;
  }
  return parsed;
}

/**
 * Extracts and validates synthesis plan headers from a response or header map.
 * Case-insensitive lookup for:
 * - X-EdgeTTS-Segment-Count
 * - X-EdgeTTS-Segment-Max-Code-Points
 */
export function parseSynthesisPlanHeaders(
  headers: Headers | Record<string, string | undefined> | null | undefined,
): SynthesisPlanMetadata {
  if (!headers) {
    return { segmentCount: null, maxSegmentCodePoints: null };
  }

  let segmentCountStr: string | null | undefined;
  let maxCodePointsStr: string | null | undefined;

  if (typeof (headers as Headers).get === "function") {
    segmentCountStr = (headers as Headers).get("x-edgetts-segment-count");
    maxCodePointsStr = (headers as Headers).get("x-edgetts-segment-max-code-points");
  } else {
    const record = headers as Record<string, string | undefined>;
    for (const key of Object.keys(record)) {
      const lower = key.toLowerCase();
      if (lower === "x-edgetts-segment-count") {
        segmentCountStr = record[key];
      } else if (lower === "x-edgetts-segment-max-code-points") {
        maxCodePointsStr = record[key];
      }
    }
  }

  return {
    segmentCount: parsePositiveIntegerHeader(segmentCountStr),
    maxSegmentCodePoints: parsePositiveIntegerHeader(maxCodePointsStr),
  };
}

/**
 * Formats byte counts using standard binary (1024 base) units: B, KiB, MiB.
 * - < 1024 -> integer B (e.g. "0 B", "999 B")
 * - < 1024 * 1024 -> one decimal max KiB (e.g. "1.0 KiB", "42.3 KiB")
 * - >= 1024 * 1024 -> one decimal max MiB (e.g. "1.8 MiB")
 */
export function formatAudioBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  if (bytes < 1024) {
    return `${Math.floor(bytes)} B`;
  }

  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(1)} KiB`;
  }

  const mib = kib / 1024;
  return `${mib.toFixed(1)} MiB`;
}

/**
 * Formats user-facing status indicator text during synthesis.
 */
export function formatGeneratingStatusText(
  telemetry: {
    readonly phase: "requesting" | "streaming";
    readonly segmentCount: number | null;
    readonly bytesReceived: number;
  },
  locale: UiLocale = "zh-CN",
): string {
  if (telemetry.phase === "requesting") {
    return translate("正在等待语音服务…", locale);
  }

  const parts: string[] = [translate("正在流式接收音频", locale)];
  if (telemetry.segmentCount !== null && telemetry.segmentCount > 0) {
    parts.push(translate("共 {count} 段", locale, { count: telemetry.segmentCount }));
  }
  if (telemetry.bytesReceived > 0) {
    parts.push(formatAudioBytes(telemetry.bytesReceived));
  }
  return parts.join(" · ");
}
