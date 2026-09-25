import { MAX_VOICE_ID_LENGTH } from "@edgetts/shared";

export { MAX_VOICE_ID_LENGTH };

export const WORKBENCH_FAVORITES_KEY = "edgetts.workbench.favoriteVoices.v1";
export const MAX_FAVORITES_COUNT = 128;

export interface StoredFavoritesV1 {
  readonly voiceIds: readonly string[];
}

export function validateFavoriteVoiceIds(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return [];
  }

  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.voiceIds)) {
    return [];
  }

  const unique = new Set<string>();
  for (const item of record.voiceIds) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed.length > 0 && trimmed.length <= MAX_VOICE_ID_LENGTH) {
        unique.add(trimmed);
        if (unique.size >= MAX_FAVORITES_COUNT) {
          break;
        }
      }
    }
  }

  return Array.from(unique);
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

export function loadFavoriteVoiceIds(storage?: Storage | null): string[] {
  const s = getSafeStorage(storage);
  if (!s) {
    return [];
  }

  try {
    const raw = s.getItem(WORKBENCH_FAVORITES_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return validateFavoriteVoiceIds(parsed);
  } catch {
    return [];
  }
}

export function saveFavoriteVoiceIds(voiceIds: Iterable<string>, storage?: Storage | null): void {
  const s = getSafeStorage(storage);
  if (!s) {
    return;
  }

  try {
    const validated = validateFavoriteVoiceIds({ voiceIds: Array.from(voiceIds) });
    s.setItem(WORKBENCH_FAVORITES_KEY, JSON.stringify({ voiceIds: validated }));
  } catch {
    // Silently ignore storage quota or permission errors
  }
}

export function toggleFavoriteVoiceId(
  currentFavorites: Iterable<string>,
  voiceId: string,
): string[] {
  const trimmed = voiceId.trim();
  if (!trimmed || trimmed.length > MAX_VOICE_ID_LENGTH) {
    return Array.from(currentFavorites);
  }

  const set = new Set<string>(currentFavorites);
  if (set.has(trimmed)) {
    set.delete(trimmed);
  } else {
    if (set.size < MAX_FAVORITES_COUNT) {
      set.add(trimmed);
    }
  }
  return Array.from(set);
}
