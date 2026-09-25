import { useId } from "react";
import type { VoiceDto } from "@edgetts/shared";
import { type MessageKey, useI18n } from "../i18n.js";
import { Checkbox, Select } from "../ui/index.js";
import { formatVoiceGender } from "../voice-catalog.js";
import type { useVoiceFilters } from "./useVoiceFilters.js";

export interface VoicePickerProps {
  readonly voices: readonly VoiceDto[];
  readonly voiceError: MessageKey | null;
  readonly selectedVoiceId: string;
  readonly onSelectVoice: (voiceId: string) => void;
  readonly filters: ReturnType<typeof useVoiceFilters>;
  readonly disabled: boolean;
}

export function VoicePicker({
  voices,
  voiceError,
  selectedVoiceId,
  onSelectVoice,
  filters,
  disabled,
}: VoicePickerProps) {
  const { locale, t } = useI18n();
  const voiceSearchId = useId();
  const localeSelectId = useId();
  const favoriteOnlyCheckboxId = useId();
  const voiceSelectId = useId();

  const activeVoice = voices.find((v) => v.id === selectedVoiceId);
  const voiceCountLabel = t("选择声音 ({count})", { count: filters.filteredVoices.length });

  return (
    <>
      {/* Voice Search & Locale Filter */}
      <div className="voice-filter-row">
        <div className="control-group search-group">
          <label htmlFor={voiceSearchId} className="control-label">
            {t("搜索声音")}
          </label>
          <input
            id={voiceSearchId}
            type="search"
            className="control-input"
            aria-describedby={`${voiceSearchId}-hint`}
            placeholder={t("搜索...")}
            value={filters.search}
            onChange={(e) => filters.setSearch(e.target.value)}
            disabled={disabled || voices.length === 0}
          />
          <span id={`${voiceSearchId}-hint`} className="control-hint">
            {t("按名称、ID、语言或性别过滤")}
          </span>
        </div>

        <div className="control-group locale-group">
          <label htmlFor={localeSelectId} className="control-label">
            {t("地区 / Locale")}
          </label>
          <Select
            id={localeSelectId}
            value={filters.locale}
            onChange={filters.setLocale}
            options={filters.localeSelectOptions}
            disabled={disabled || voices.length === 0}
            aria-label={t("地区 / Locale")}
          />
        </div>
      </div>

      {/* Favorite Only Filter */}
      <div className="favorite-filter-row">
        <Checkbox
          id={favoriteOnlyCheckboxId}
          checked={filters.favoriteOnly}
          onChange={filters.setFavoriteOnly}
          disabled={disabled || filters.totalFavoritesInCatalog === 0}
          label={t("只看收藏")}
        />
      </div>

      {/* Voice Selection */}
      <div className="control-group">
        <label htmlFor={voiceSelectId} className="control-label">
          {voiceCountLabel}
        </label>
        {voiceError ? (
          <div className="control-error" role="alert">
            {t(voiceError)}
          </div>
        ) : (
          <Select
            id={voiceSelectId}
            value={filters.isSelectedVoiceVisible ? selectedVoiceId : ""}
            onChange={(newVoice) => {
              if (newVoice) {
                onSelectVoice(newVoice);
              }
            }}
            options={filters.voicePlaceholderOptions}
            groups={filters.filteredVoices.length > 0 ? filters.voiceSelectGroups : undefined}
            disabled={disabled || filters.filteredVoices.length === 0}
            aria-label={voiceCountLabel}
          />
        )}

        {/* Current Voice Details & Favorite Action */}
        {activeVoice && (
          <div className="current-voice-details" aria-label={t("当前声音详情")}>
            <div className="current-voice-meta">
              <span className="current-voice-title">
                {activeVoice.displayName} · {activeVoice.locale} ·{" "}
                {formatVoiceGender(activeVoice.gender, locale)}
              </span>
              <span className="current-voice-id">{activeVoice.id}</span>
            </div>
            <button
              type="button"
              className={`btn-favorite ${filters.isSelectedVoiceFavorite ? "is-favorite" : ""}`}
              onClick={filters.toggleSelectedFavorite}
              disabled={disabled || !selectedVoiceId}
              aria-pressed={filters.isSelectedVoiceFavorite}
              aria-label={
                filters.isSelectedVoiceFavorite ? t("取消收藏当前声音") : t("收藏当前声音")
              }
            >
              {filters.isSelectedVoiceFavorite ? t("★ 已收藏") : t("☆ 收藏")}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
