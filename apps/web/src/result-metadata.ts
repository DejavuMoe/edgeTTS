import { formatAudioBytes } from "./synthesis-telemetry.js";

export interface CompletedResultMeta {
  readonly voiceId: string;
  readonly voiceDisplayName: string;
  readonly quality: "standard" | "high";
  readonly speed: number;
  readonly pitchSemitones: number;
  readonly volume: number;
  readonly completedAt: number;
  readonly filename: string;
  readonly segmentCount?: number | null;
  readonly audioBytes?: number | null;
}

export interface GenerationSnapshot {
  readonly voiceId: string;
  readonly voiceDisplayName: string;
  readonly quality: "standard" | "high";
  readonly speed: number;
  readonly pitchSemitones: number;
  readonly volume: number;
  readonly segmentCount?: number | null;
  readonly audioBytes?: number | null;
}

export function sanitizeVoiceSlug(voiceId: string): string {
  const sanitized = voiceId
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const truncated = sanitized.slice(0, 80).replace(/-+$/, "");
  return truncated || "voice";
}

export function formatTimestampSlug(dateOrTime: Date | number): string {
  const d = typeof dateOrTime === "number" ? new Date(dateOrTime) : dateOrTime;
  const year = d.getFullYear().toString().padStart(4, "0");
  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  const hours = d.getHours().toString().padStart(2, "0");
  const mins = d.getMinutes().toString().padStart(2, "0");
  const secs = d.getSeconds().toString().padStart(2, "0");
  return `${year}${month}${day}-${hours}${mins}${secs}`;
}

export function formatCompletedAt(dateOrTime: Date | number): string {
  const d = typeof dateOrTime === "number" ? new Date(dateOrTime) : dateOrTime;
  const year = d.getFullYear().toString().padStart(4, "0");
  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  const hours = d.getHours().toString().padStart(2, "0");
  const mins = d.getMinutes().toString().padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${mins}`;
}

export function buildDownloadFilename(
  voiceId: string,
  quality: "standard" | "high",
  dateOrTime: Date | number,
): string {
  const voiceSlug = sanitizeVoiceSlug(voiceId);
  const safeQuality = quality === "high" ? "high" : "standard";
  const timeSlug = formatTimestampSlug(dateOrTime);
  return `edgetts_${voiceSlug}_${safeQuality}_${timeSlug}.mp3`;
}

export function createCompletedResultMeta(
  snapshot: GenerationSnapshot,
  completedAt: Date | number = Date.now(),
): CompletedResultMeta {
  const timestamp = typeof completedAt === "number" ? completedAt : completedAt.getTime();
  const filename = buildDownloadFilename(snapshot.voiceId, snapshot.quality, timestamp);
  return {
    ...snapshot,
    completedAt: timestamp,
    filename,
  };
}

export function formatResultMetadataDisplay(meta: CompletedResultMeta): string {
  const qualityText = meta.quality === "high" ? "高品质" : "标准";
  const speedText = `${meta.speed.toFixed(2)}×`;
  const parts: string[] = [meta.voiceDisplayName, meta.voiceId, qualityText, speedText];

  if (meta.pitchSemitones !== 0) {
    const pitchSign =
      meta.pitchSemitones > 0 ? `+${meta.pitchSemitones}` : `${meta.pitchSemitones}`;
    parts.push(`${pitchSign}半音`);
  }

  if (meta.volume !== 1.0) {
    parts.push(`${Math.round(meta.volume * 100)}%音量`);
  }

  if (meta.segmentCount !== undefined && meta.segmentCount !== null && meta.segmentCount > 0) {
    parts.push(`${meta.segmentCount} 段`);
  }

  if (meta.audioBytes !== undefined && meta.audioBytes !== null && meta.audioBytes >= 0) {
    parts.push(formatAudioBytes(meta.audioBytes));
  }

  parts.push(formatCompletedAt(meta.completedAt));
  return parts.join(" · ");
}
