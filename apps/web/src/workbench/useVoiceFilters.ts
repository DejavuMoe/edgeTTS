import { useMemo, useState } from "react";
import type { VoiceDto } from "@edgetts/shared";
import type { UiLocale, useI18n } from "../i18n.js";
import type { SelectOption } from "../ui/Select.js";
import {
  filterVoices,
  getGroupedVoices,
  getLocaleOptions,
  isVoiceVisible,
} from "../lib/voice-catalog.js";
import {
  loadFavoriteVoiceIds,
  saveFavoriteVoiceIds,
  toggleFavoriteVoiceId,
} from "../lib/voice-favorites.js";
import { localeDisplayName } from "../lib/voice-names.js";

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

  // The locale code and count stay the option label; the localized region name is secondary.
  const localeSelectOptions: SelectOption[] = useMemo(
    () =>
      localeOptions.map((opt) => {
        const regionName = opt.locale === "all" ? null : localeDisplayName(opt.locale, uiLocale);
        return {
          value: opt.locale,
          label: opt.label,
          ...(regionName ? { secondaryLabel: regionName } : {}),
        };
      }),
    [localeOptions, uiLocale],
  );

  const emptyMessage = t("没有匹配的声音");
  /** Set when the selected voice is hidden by the filters, so the list can say why. */
  const hiddenSelectionNotice =
    filteredVoices.length > 0 && selectedVoiceId && !isSelectedVoiceVisible
      ? t("当前声音不在筛选结果中")
      : null;

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
    voiceGroups,
    emptyMessage,
    hiddenSelectionNotice,
  };
}
