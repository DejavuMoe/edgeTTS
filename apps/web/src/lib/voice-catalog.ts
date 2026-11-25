import { LANGUAGE_OPTIONS, translate, type UiLocale } from "../i18n.js";
import type { VoiceDto } from "@edgetts/shared";
import { LOCALE_SEARCH_ALIASES } from "./locale-aliases.js";
import { localeDisplayName } from "./voice-names.js";

export interface LocaleOption {
  readonly locale: string;
  readonly label: string;
  readonly count: number;
}

export interface VoiceGroup {
  readonly label: string;
  /** The shared locale of a locale group; null for the favorites group. */
  readonly locale: string | null;
  readonly voices: readonly VoiceDto[];
}

export interface CatalogFilterCriteria {
  readonly search: string;
  readonly uiLocale?: UiLocale;
  readonly locale: string;
  readonly favoriteOnly: boolean;
  readonly favoriteIds: ReadonlySet<string>;
}

const collators = new Map<string, Intl.Collator>();

function collatorFor(uiLocale: UiLocale): Intl.Collator {
  let collator = collators.get(uiLocale);
  if (!collator) {
    collator = new Intl.Collator(uiLocale);
    collators.set(uiLocale, collator);
  }
  return collator;
}

/**
 * Orders locales for the interface language: the interface's own locale first (zh-CN for
 * 简体中文), then the rest of its language, then all others, each tier by the name the
 * interface shows for it. So a Japanese interface starts with Japanese voices and lists the
 * rest in its own reading order, instead of by code from af-ZA.
 */
export function compareLocales(uiLocale: UiLocale): (a: string, b: string) => number {
  const language = uiLocale.split("-")[0];
  const rank = (locale: string): number =>
    locale === uiLocale ? 0 : locale.split("-")[0] === language ? 1 : 2;
  const names = new Map<string, string>();
  const nameOf = (locale: string): string => {
    let name = names.get(locale);
    if (name === undefined) {
      name = localeDisplayName(locale, uiLocale) ?? locale;
      names.set(locale, name);
    }
    return name;
  };
  const collator = collatorFor(uiLocale);
  return (a, b) =>
    rank(a) - rank(b) || collator.compare(nameOf(a), nameOf(b)) || a.localeCompare(b);
}

export function getLocaleOptions(
  voices: readonly VoiceDto[],
  locale: UiLocale = "zh-CN",
): LocaleOption[] {
  const counts = new Map<string, number>();
  for (const v of voices) {
    counts.set(v.locale, (counts.get(v.locale) ?? 0) + 1);
  }

  const sortedLocales = Array.from(counts.keys()).sort(compareLocales(locale));

  const allOption: LocaleOption = {
    locale: "all",
    label: translate("全部地区 ({count})", locale, { count: voices.length }),
    count: voices.length,
  };

  const localeOptions: LocaleOption[] = sortedLocales.map((loc) => ({
    locale: loc,
    label: `${loc} (${counts.get(loc) ?? 0})`,
    count: counts.get(loc) ?? 0,
  }));

  return [allOption, ...localeOptions];
}

export function formatVoiceGender(gender: string, locale: UiLocale = "zh-CN"): string {
  return gender === "Male" || gender === "Female" || gender === "Unknown"
    ? translate(gender, locale)
    : gender;
}

/** Case- and width-insensitive form for substring search: "ＣＨＩＮＥＳＥ（" matches "chinese (". */
function searchForm(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

const localeSearchTexts = new Map<string, string>();

/**
 * Everything a locale answers to in a search: its code, its name in every interface language,
 * so "日语" finds Japanese voices whichever language the interface is in, and its aliases.
 */
function localeSearchText(locale: string): string {
  let text = localeSearchTexts.get(locale);
  if (text === undefined) {
    const names = LANGUAGE_OPTIONS.map(({ value }) => localeDisplayName(locale, value) ?? "");
    // One name per line, so a query cannot match across the end of one and the start of the next.
    text = searchForm([locale, ...names, ...(LOCALE_SEARCH_ALIASES[locale] ?? [])].join("\n"));
    localeSearchTexts.set(locale, text);
  }
  return text;
}

export function matchesVoiceSearch(
  voice: VoiceDto,
  search: string,
  locale: UiLocale = "zh-CN",
): boolean {
  const q = searchForm(search.trim());
  if (!q) {
    return true;
  }

  return (
    searchForm(voice.displayName).includes(q) ||
    voice.id.toLowerCase().includes(q) ||
    localeSearchText(voice.locale).includes(q) ||
    voice.gender.toLowerCase().includes(q) ||
    searchForm(formatVoiceGender(voice.gender, locale)).includes(q)
  );
}

export function filterVoices(
  voices: readonly VoiceDto[],
  criteria: CatalogFilterCriteria,
): VoiceDto[] {
  return voices.filter((voice) => {
    if (criteria.locale !== "all" && voice.locale !== criteria.locale) {
      return false;
    }
    if (criteria.favoriteOnly && !criteria.favoriteIds.has(voice.id)) {
      return false;
    }
    return matchesVoiceSearch(voice, criteria.search, criteria.uiLocale);
  });
}

export function getGroupedVoices(
  filteredVoices: readonly VoiceDto[],
  favoriteIds: ReadonlySet<string>,
  locale: UiLocale = "zh-CN",
): VoiceGroup[] {
  const favorites: VoiceDto[] = [];
  const nonFavoritesByLocale = new Map<string, VoiceDto[]>();

  for (const voice of filteredVoices) {
    if (favoriteIds.has(voice.id)) {
      favorites.push(voice);
    } else {
      let group = nonFavoritesByLocale.get(voice.locale);
      if (!group) {
        group = [];
        nonFavoritesByLocale.set(voice.locale, group);
      }
      group.push(voice);
    }
  }

  const compareLocale = compareLocales(locale);
  // Sort favorites: locale (in the interface's order) -> displayName -> id
  favorites.sort(
    (a, b) =>
      compareLocale(a.locale, b.locale) ||
      a.displayName.localeCompare(b.displayName) ||
      a.id.localeCompare(b.id),
  );

  const groups: VoiceGroup[] = [];

  if (favorites.length > 0) {
    groups.push({
      label: translate("收藏", locale),
      locale: null,
      voices: favorites,
    });
  }

  // Locale groups in the same order as the locale filter
  const sortedLocales = Array.from(nonFavoritesByLocale.keys()).sort(compareLocale);

  for (const loc of sortedLocales) {
    const list = nonFavoritesByLocale.get(loc)!;
    // Sort voices in group: displayName -> id
    list.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
    groups.push({
      label: loc,
      locale: loc,
      voices: list,
    });
  }

  return groups;
}

export function isVoiceVisible(filteredVoices: readonly VoiceDto[], voiceId: string): boolean {
  if (!voiceId) {
    return false;
  }
  return filteredVoices.some((v) => v.id === voiceId);
}
