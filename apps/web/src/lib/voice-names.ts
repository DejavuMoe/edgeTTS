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
