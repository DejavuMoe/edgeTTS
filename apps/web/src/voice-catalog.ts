import type { VoiceDto } from "@edgetts/shared";

export interface LocaleOption {
  readonly locale: string;
  readonly label: string;
  readonly count: number;
}

export interface VoiceGroup {
  readonly label: string;
  readonly voices: readonly VoiceDto[];
}

export interface CatalogFilterCriteria {
  readonly search: string;
  readonly locale: string;
  readonly favoriteOnly: boolean;
  readonly favoriteIds: ReadonlySet<string>;
}

export function getLocaleOptions(voices: readonly VoiceDto[]): LocaleOption[] {
  const counts = new Map<string, number>();
  for (const v of voices) {
    counts.set(v.locale, (counts.get(v.locale) ?? 0) + 1);
  }

  const sortedLocales = Array.from(counts.keys()).sort((a, b) => a.localeCompare(b));

  const allOption: LocaleOption = {
    locale: "all",
    label: `全部地区 (${voices.length})`,
    count: voices.length,
  };

  const localeOptions: LocaleOption[] = sortedLocales.map((loc) => ({
    locale: loc,
    label: `${loc} (${counts.get(loc) ?? 0})`,
    count: counts.get(loc) ?? 0,
  }));

  return [allOption, ...localeOptions];
}

export function matchesVoiceSearch(voice: VoiceDto, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) {
    return true;
  }

  return (
    voice.displayName.toLowerCase().includes(q) ||
    voice.id.toLowerCase().includes(q) ||
    voice.locale.toLowerCase().includes(q) ||
    voice.gender.toLowerCase().includes(q)
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
    return matchesVoiceSearch(voice, criteria.search);
  });
}

export function getGroupedVoices(
  filteredVoices: readonly VoiceDto[],
  favoriteIds: ReadonlySet<string>,
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

  // Sort favorites: locale -> displayName -> id
  favorites.sort(
    (a, b) =>
      a.locale.localeCompare(b.locale) ||
      a.displayName.localeCompare(b.displayName) ||
      a.id.localeCompare(b.id),
  );

  const groups: VoiceGroup[] = [];

  if (favorites.length > 0) {
    groups.push({
      label: "收藏",
      voices: favorites,
    });
  }

  // Sort locale groups by locale lexical ascending
  const sortedLocales = Array.from(nonFavoritesByLocale.keys()).sort((a, b) => a.localeCompare(b));

  for (const loc of sortedLocales) {
    const list = nonFavoritesByLocale.get(loc)!;
    // Sort voices in group: displayName -> id
    list.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
    groups.push({
      label: loc,
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
