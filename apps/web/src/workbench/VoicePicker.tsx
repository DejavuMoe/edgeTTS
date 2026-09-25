import { useId, useRef } from "react";
import type { VoiceDto } from "@edgetts/shared";
import { type MessageKey, useI18n } from "../i18n.js";
import { formatVoiceGender } from "../lib/voice-catalog.js";
import { localeDisplayName, shortVoiceName } from "../lib/voice-names.js";
import { Checkbox, Select } from "../ui/index.js";
import type { useVoiceFilters } from "./useVoiceFilters.js";
import { VoiceList } from "./VoiceList.js";

export interface VoicePickerProps {
  readonly voices: readonly VoiceDto[];
  readonly voiceError: MessageKey | null;
  readonly selectedVoiceId: string;
  readonly onSelectVoice: (voiceId: string) => void;
  readonly filters: ReturnType<typeof useVoiceFilters>;
  readonly disabled: boolean;
}

function StarIcon({ filled }: { readonly filled: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
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
  const titleId = useId();
  const searchId = useId();
  const localeSelectId = useId();
  const favoriteOnlyId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);

  const activeVoice = voices.find((v) => v.id === selectedVoiceId);
  const favorite = filters.isSelectedVoiceFavorite;
  const noCatalog = voices.length === 0;

  return (
    <section className="inspector-section voice-section" aria-labelledby={titleId}>
      <div className="section-header">
        <h2 id={titleId} className="section-title">
          {t("声音")}
        </h2>
        <Checkbox
          id={favoriteOnlyId}
          checked={filters.favoriteOnly}
          onChange={filters.setFavoriteOnly}
          disabled={disabled || filters.totalFavoritesInCatalog === 0}
          label={t("只看收藏")}
        />
      </div>

      {activeVoice && (
        <div className="voice-current" aria-label={t("当前声音详情")}>
          <div className="voice-current-text" title={activeVoice.displayName}>
            <span className="voice-current-name">{shortVoiceName(activeVoice)}</span>
            <span className="voice-current-meta">
              <span>{localeDisplayName(activeVoice.locale, locale) ?? activeVoice.locale}</span>{" "}
              <span>· {formatVoiceGender(activeVoice.gender, locale)}</span>
            </span>
            <span className="voice-current-id">{activeVoice.id}</span>
          </div>
          <button
            type="button"
            className={`btn-favorite ${favorite ? "is-favorite" : ""}`}
            onClick={filters.toggleSelectedFavorite}
            disabled={disabled}
            aria-pressed={favorite}
            aria-label={favorite ? t("取消收藏当前声音") : t("收藏当前声音")}
          >
            <StarIcon filled={favorite} />
            <span>{favorite ? t("已收藏") : t("加入收藏")}</span>
          </button>
        </div>
      )}

      <div className="voice-filters">
        <div className="field field-search">
          <label htmlFor={searchId} className="visually-hidden">
            {t("搜索声音")}
          </label>
          <input
            id={searchId}
            type="search"
            className="control-input"
            aria-describedby={`${searchId}-hint`}
            placeholder={t("搜索...")}
            value={filters.search}
            onChange={(e) => filters.setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                listRef.current?.focus();
              }
            }}
            disabled={disabled || noCatalog}
          />
          <span id={`${searchId}-hint`} className="visually-hidden">
            {t("按名称、ID、语言或性别过滤")}
          </span>
        </div>
        <div className="field field-locale">
          <label htmlFor={localeSelectId} className="visually-hidden">
            {t("地区 / Locale")}
          </label>
          <Select
            id={localeSelectId}
            value={filters.locale}
            onChange={filters.setLocale}
            options={filters.localeSelectOptions}
            disabled={disabled || noCatalog}
            aria-label={t("地区 / Locale")}
          />
        </div>
      </div>

      {filters.hiddenSelectionNotice && (
        <p className="voice-notice" role="status">
          {filters.hiddenSelectionNotice}
        </p>
      )}

      {voiceError ? (
        <div className="inline-alert" role="alert">
          {t(voiceError)}
        </div>
      ) : (
        <VoiceList
          ref={listRef}
          groups={filters.voiceGroups}
          selectedVoiceId={selectedVoiceId}
          onSelect={onSelectVoice}
          aria-label={t("选择声音 ({count})", { count: filters.filteredVoices.length })}
          disabled={disabled}
          emptyMessage={filters.emptyMessage}
        />
      )}
    </section>
  );
}
