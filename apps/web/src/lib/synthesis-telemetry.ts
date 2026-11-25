import { translate, type UiLocale } from "../i18n.js";
import { formatMediaTime } from "./media-time.js";
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
  /** Bytes per second of the audio being received; the MP3 is constant bitrate. */
  readonly bytesPerSecond?: number | null;
  /** About how long the take will be, in seconds; null when the text gives no estimate. */
  readonly expectedSeconds?: number | null;
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

/** Joins the parts of the generating status line. */
export const STATUS_SEPARATOR = " · ";

interface GeneratingStatus {
  readonly phase: "requesting" | "streaming";
  readonly segmentCount: number | null;
  readonly bytesReceived: number;
  readonly bytesPerSecond?: number | null;
  readonly expectedSeconds?: number | null;
}

/** The estimate can run short, so a take still arriving never shows as complete. */
const MAX_ARRIVING_PERCENT = 99;

/** The share of the expected length that has arrived, as a whole percent; null if unknown. */
export function estimateArrivedPercent(
  receivedSeconds: number,
  expectedSeconds: number | null | undefined,
): number | null {
  if (!expectedSeconds || !Number.isFinite(expectedSeconds) || expectedSeconds <= 0) return null;
  const percent = Math.floor((Math.max(0, receivedSeconds) / expectedSeconds) * 100);
  return Math.min(MAX_ARRIVING_PERCENT, percent);
}

/** The stage a synthesis is at, without its byte count: what a screen reader announces. */
export function formatGeneratingPhaseText(
  telemetry: Omit<GeneratingStatus, "bytesReceived">,
  locale: UiLocale = "zh-CN",
): string {
  if (telemetry.phase === "requesting") {
    return translate("正在等待语音服务…", locale);
  }

  const parts: string[] = [translate("正在流式接收音频", locale)];
  if (telemetry.segmentCount !== null && telemetry.segmentCount > 0) {
    parts.push(translate("共 {count} 段", locale, { count: telemetry.segmentCount }));
  }
  return parts.join(STATUS_SEPARATOR);
}

/** The audio received so far, shown after the phase once streaming has begun; else null. */
export function formatGeneratingBytesText(telemetry: GeneratingStatus): string | null {
  return telemetry.phase === "streaming" && telemetry.bytesReceived > 0
    ? formatAudioBytes(telemetry.bytesReceived)
    : null;
}

/**
 * How much audio has arrived, shown after the phase once streaming has begun; else null. With
 * the bitrate known it is seconds of audio and, when the text gave an estimate, about what share
 * of the take that is; otherwise the byte count.
 */
export function formatGeneratingProgressText(
  telemetry: GeneratingStatus,
  locale: UiLocale = "zh-CN",
): string | null {
  const bytes = formatGeneratingBytesText(telemetry);
  const bytesPerSecond = telemetry.bytesPerSecond;
  if (bytes === null || !bytesPerSecond || bytesPerSecond <= 0) return bytes;

  const seconds = telemetry.bytesReceived / bytesPerSecond;
  const time = formatMediaTime(seconds);
  const percent = estimateArrivedPercent(seconds, telemetry.expectedSeconds);
  return percent === null
    ? translate("已接收 {time}", locale, { time })
    : translate("已接收 {time}（约 {percent}%）", locale, { time, percent });
}

/**
 * Formats user-facing status indicator text during synthesis.
 */
export function formatGeneratingStatusText(
  telemetry: GeneratingStatus,
  locale: UiLocale = "zh-CN",
): string {
  const progress = formatGeneratingProgressText(telemetry, locale);
  const phase = formatGeneratingPhaseText(telemetry, locale);
  return progress ? `${phase}${STATUS_SEPARATOR}${progress}` : phase;
}
