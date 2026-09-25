import type { VoiceDto } from "@edgetts/shared";

export const WORKBENCH_PREFERENCES_KEY = "edgetts.workbench.preferences.v1";

export interface WorkbenchPreferencesV1 {
  readonly voiceId: string;
  readonly quality: "standard" | "high";
  readonly speed: number;
  readonly pitchSemitones: number;
  readonly volume: number;
}

export const DEFAULT_WORKBENCH_PREFERENCES: WorkbenchPreferencesV1 = {
  voiceId: "",
  quality: "standard",
  speed: 1.0,
  pitchSemitones: 0,
  volume: 1.0,
};

export function validateWorkbenchPreferences(raw: unknown): WorkbenchPreferencesV1 {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_WORKBENCH_PREFERENCES };
  }

  const record = raw as Record<string, unknown>;

  // voiceId: non-empty string
  const voiceId =
    typeof record.voiceId === "string" && record.voiceId.trim().length > 0
      ? record.voiceId.trim()
      : DEFAULT_WORKBENCH_PREFERENCES.voiceId;

  // quality: "standard" | "high"
  const quality =
    record.quality === "standard" || record.quality === "high"
      ? record.quality
      : DEFAULT_WORKBENCH_PREFERENCES.quality;

  // speed: finite number, 0.5 <= speed <= 2.0
  const speed =
    typeof record.speed === "number" &&
    Number.isFinite(record.speed) &&
    record.speed >= 0.5 &&
    record.speed <= 2.0
      ? record.speed
      : DEFAULT_WORKBENCH_PREFERENCES.speed;

  // pitchSemitones: finite integer, -12 <= pitchSemitones <= 12
  const pitchSemitones =
    typeof record.pitchSemitones === "number" &&
    Number.isFinite(record.pitchSemitones) &&
    Number.isInteger(record.pitchSemitones) &&
    record.pitchSemitones >= -12 &&
    record.pitchSemitones <= 12
      ? record.pitchSemitones
      : DEFAULT_WORKBENCH_PREFERENCES.pitchSemitones;

  // volume: finite number, 0.0 <= volume <= 1.0
  const volume =
    typeof record.volume === "number" &&
    Number.isFinite(record.volume) &&
    record.volume >= 0 &&
    record.volume <= 1
      ? record.volume
      : DEFAULT_WORKBENCH_PREFERENCES.volume;

  return {
    voiceId,
    quality,
    speed,
    pitchSemitones,
    volume,
  };
}

function getSafeStorage(customStorage?: Storage | null): Storage | null {
  if (customStorage !== undefined) {
    return customStorage;
  }
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // SecurityError or restricted sandbox
  }
  return null;
}

export function loadWorkbenchPreferences(storage?: Storage | null): WorkbenchPreferencesV1 {
  const s = getSafeStorage(storage);
  if (!s) {
    return { ...DEFAULT_WORKBENCH_PREFERENCES };
  }

  try {
    const raw = s.getItem(WORKBENCH_PREFERENCES_KEY);
    if (!raw) {
      return { ...DEFAULT_WORKBENCH_PREFERENCES };
    }
    const parsed: unknown = JSON.parse(raw);
    return validateWorkbenchPreferences(parsed);
  } catch {
    return { ...DEFAULT_WORKBENCH_PREFERENCES };
  }
}

export function saveWorkbenchPreferences(
  preferences: Partial<WorkbenchPreferencesV1>,
  storage?: Storage | null,
): void {
  const s = getSafeStorage(storage);
  if (!s) {
    return;
  }

  try {
    const validated = validateWorkbenchPreferences(preferences);
    s.setItem(WORKBENCH_PREFERENCES_KEY, JSON.stringify(validated));
  } catch {
    // Silently ignore storage quota or permission errors
  }
}

export function resolveEffectiveVoiceId(
  voiceList: readonly VoiceDto[],
  preferredVoiceId?: string,
): string {
  if (preferredVoiceId) {
    const matched = voiceList.find((v) => v.id === preferredVoiceId);
    if (matched) {
      return matched.id;
    }
  }

  // Default selection cascade:
  const xiaoxiao = voiceList.find((v) => v.id === "zh-CN-XiaoxiaoNeural");
  const anyZh = voiceList.find((v) => v.locale.toLowerCase().startsWith("zh-cn"));
  const firstAvailable = voiceList[0];
  return xiaoxiao?.id ?? anyZh?.id ?? firstAvailable?.id ?? "";
}
