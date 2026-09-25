import type { VoiceDto } from "@edgetts/shared";

/**
 * The speaker's name without vendor boilerplate: "Microsoft Xiaoxiao Online (Natural) -
 * Chinese (Mainland)" becomes "Xiaoxiao". Unrecognized formats are returned unchanged.
 */
export function shortVoiceName(voice: Pick<VoiceDto, "displayName">): string {
  const withoutVendor = voice.displayName.replace(/^Microsoft\s+/, "");
  const name = withoutVendor.split(/\s+Online\s+\(Natural\)|\s+-\s+/)[0]?.trim();
  return name || voice.displayName;
}

const displayNamesCache = new Map<string, Intl.DisplayNames | null>();

function languageNames(uiLocale: string): Intl.DisplayNames | null {
  let names = displayNamesCache.get(uiLocale);
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames([uiLocale], { type: "language", fallback: "none" });
    } catch {
      names = null;
    }
    displayNamesCache.set(uiLocale, names);
  }
  return names;
}

/** "zh-CN" in the interface language, e.g. "中文（中国）" or "Chinese (China)"; null if unknown. */
export function localeDisplayName(locale: string, uiLocale: string): string | null {
  try {
    return languageNames(uiLocale)?.of(locale) ?? null;
  } catch {
    return null;
  }
}

/**
 * A stable hue (0–359) for a voice, so its monogram keeps one colour across sessions. FNV-1a
 * over the ID spreads neighbouring IDs ("…XiaoxiaoNeural", "…XiaoyiNeural") far apart.
 */
export function voiceHue(voiceId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < voiceId.length; i++) {
    hash ^= voiceId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 360;
}

/** The monogram letter: the first letter of the short name. */
export function voiceInitial(voice: Pick<VoiceDto, "displayName">): string {
  return Array.from(shortVoiceName(voice))[0]?.toLocaleUpperCase() ?? "?";
}
