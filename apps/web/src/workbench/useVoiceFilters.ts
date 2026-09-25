import { useMemo, useState } from "react";
import type { VoiceDto } from "@edgetts/shared";
import type { UiLocale, useI18n } from "../i18n.js";
import type { SelectGroup, SelectOption } from "../ui/Select.js";
import {
  filterVoices,
  formatVoiceGender,
  getGroupedVoices,
  getLocaleOptions,
  isVoiceVisible,
} from "../voice-catalog.js";
import {
  loadFavoriteVoiceIds,
  saveFavoriteVoiceIds,
  toggleFavoriteVoiceId,
} from "../voice-favorites.js";

type Translate = ReturnType<typeof useI18n>["t"];

/**
 * Voice search, locale and favorites filtering, plus the favorites list itself. Filters are
 * ephemeral; favorites persist to local storage.
 */
export function useVoiceFilters(
  voices: readonly VoiceDto[],
  selectedVoiceId: string,
  uiLocale: UiLocale,
  t: Translate,
) {
  const [favoriteVoiceIds, setFavoriteVoiceIds] = useState<string[]>(() => loadFavoriteVoiceIds());
  const [search, setSearch] = useState<string>("");
  const [locale, setLocale] = useState<string>("all");
  const [favoriteOnly, setFavoriteOnly] = useState<boolean>(false);

  const favoriteSet = useMemo(() => new Set(favoriteVoiceIds), [favoriteVoiceIds]);

  const localeOptions = useMemo(() => getLocaleOptions(voices, uiLocale), [voices, uiLocale]);

  const totalFavoritesInCatalog = useMemo(
    () => voices.filter((v) => favoriteSet.has(v.id)).length,
    [voices, favoriteSet],
  );

  const filteredVoices = useMemo(
    () =>
      filterVoices(voices, {
        search,
        locale,
        favoriteOnly,
        favoriteIds: favoriteSet,
        uiLocale,
      }),
    [voices, search, locale, favoriteOnly, favoriteSet, uiLocale],
  );

  const isSelectedVoiceVisible = useMemo(
    () => isVoiceVisible(filteredVoices, selectedVoiceId),
    [filteredVoices, selectedVoiceId],
  );

  // Hierarchical grouped catalog: Favorites first, then Locale groups
  const voiceGroups = useMemo(
    () => getGroupedVoices(filteredVoices, favoriteSet, uiLocale),
    [filteredVoices, favoriteSet, uiLocale],
  );

  const localeSelectOptions: SelectOption[] = useMemo(
    () => localeOptions.map((opt) => ({ value: opt.locale, label: opt.label })),
    [localeOptions],
  );

  const voiceSelectGroups: SelectGroup[] = useMemo(
    () =>
      voiceGroups.map((group) => ({
        label: group.label,
        options: group.voices.map((v) => ({
          value: v.id,
          label: v.displayName,
          secondaryLabel: `${v.locale} · ${formatVoiceGender(v.gender, uiLocale)}`,
        })),
      })),
    [voiceGroups, uiLocale],
  );

  const voicePlaceholderOptions: SelectOption[] | undefined = useMemo(() => {
    if (filteredVoices.length === 0) {
      return [{ value: "", label: t("没有匹配的声音"), disabled: true }];
    }
    if (!isSelectedVoiceVisible) {
      return [{ value: "", label: t("当前声音不在筛选结果中"), disabled: true }];
    }
    return undefined;
  }, [filteredVoices.length, isSelectedVoiceVisible, t]);

  const isSelectedVoiceFavorite = Boolean(selectedVoiceId && favoriteSet.has(selectedVoiceId));

  const toggleSelectedFavorite = (): void => {
    if (!selectedVoiceId) return;
    const next = toggleFavoriteVoiceId(favoriteVoiceIds, selectedVoiceId);
    setFavoriteVoiceIds(next);
    saveFavoriteVoiceIds(next);
    const nextSet = new Set(next);
    const remainingInCatalog = voices.filter((v) => nextSet.has(v.id)).length;
    if (remainingInCatalog === 0) {
      setFavoriteOnly(false);
    }
  };

  return {
    search,
    setSearch,
    locale,
    setLocale,
    favoriteOnly,
    setFavoriteOnly,
    totalFavoritesInCatalog,
    filteredVoices,
    isSelectedVoiceVisible,
    isSelectedVoiceFavorite,
    toggleSelectedFavorite,
    localeSelectOptions,
    voiceSelectGroups,
    voicePlaceholderOptions,
  };
}
