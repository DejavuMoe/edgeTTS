import { useId, useRef, type Ref } from "react";
import type { VoiceDto } from "@edgetts/shared";
import { type MessageKey, useI18n } from "../i18n.js";
import { formatVoiceGender } from "../lib/voice-catalog.js";
import { localeDisplayName, shortVoiceName } from "../lib/voice-names.js";
import { Checkbox, Select } from "../ui/index.js";
import type { useVoiceFilters } from "./useVoiceFilters.js";
import type { PreviewStatus } from "./useVoicePreview.js";
import type { CatalogStatus } from "./useWorkbenchConnection.js";
import { VoiceAvatar } from "./VoiceAvatar.js";
import { VoiceList } from "./VoiceList.js";

export interface VoicePickerProps {
  readonly voices: readonly VoiceDto[];
  readonly voiceError: MessageKey | null;
  readonly selectedVoiceId: string;
  readonly onSelectVoice: (voiceId: string) => void;
  readonly filters: ReturnType<typeof useVoiceFilters>;
  readonly catalogStatus: CatalogStatus;
  readonly sectionRef?: Ref<HTMLElement>;
  /** Hearing the selected voice before writing for it. */
  readonly preview?: VoicePreviewControl | undefined;
}

export interface VoicePreviewControl {
  readonly status: PreviewStatus;
  readonly error: MessageKey | null;
  readonly onToggle: () => void;
  readonly disabled?: boolean | undefined;
}

/** The badge: a speaker at rest, a stop square while playing, a turning ring while loading. */
function PreviewIcon({ status }: { readonly status: PreviewStatus }) {
  if (status === "playing") {
    return (
      <svg viewBox="0 0 16 16" width="8" height="8" aria-hidden="true">
        <rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" />
      </svg>
    );
  }
  if (status === "loading") {
    return <span className="voice-preview-spinner" aria-hidden="true" />;
  }
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      <path d="M10.6 5.6a3.4 3.4 0 0 1 0 4.8" />
      <path d="M12.6 3.6a6.2 6.2 0 0 1 0 8.8" />
    </svg>
  );
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
  catalogStatus,
  sectionRef,
  preview,
}: VoicePickerProps) {
  const { locale, t } = useI18n();
  const titleId = useId();
  const searchId = useId();
  const localeSelectId = useId();
  const favoriteOnlyId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);

  const activeVoice = voices.find((v) => v.id === selectedVoiceId);
  const previewLabel =
    preview?.status === "idle" && activeVoice
      ? t("试听 {name}", { name: shortVoiceName(activeVoice) })
      : t("停止试听");
  const favorite = filters.isSelectedVoiceFavorite;
  const noCatalog = voices.length === 0;
  // Until the catalog arrives an empty list says why, rather than that nothing matched.
  const emptyMessage =
    catalogStatus === "loading"
      ? t("正在加载声音…")
      : catalogStatus === "locked"
        ? t("输入 API Key 后显示声音")
        : noCatalog
          ? t("暂无可用的声音")
          : filters.emptyMessage;

  return (
    <section ref={sectionRef} className="inspector-section voice-section" aria-labelledby={titleId}>
      <div className="section-header">
        <h2 id={titleId} className="section-title">
          {t("声音")}
        </h2>
        <Checkbox
          id={favoriteOnlyId}
          checked={filters.favoriteOnly}
          onChange={filters.setFavoriteOnly}
          disabled={filters.totalFavoritesInCatalog === 0 && !filters.favoriteOnly}
          label={t("只看收藏")}
        />
      </div>

      {activeVoice && (
        <div className="voice-current" aria-label={t("当前声音详情")}>
          {preview ? (
            // The voice's face plays its voice: the badge says so, and what a press will do.
            <button
              type="button"
              className="voice-current-preview"
              data-status={preview.status}
              onClick={preview.onToggle}
              disabled={preview.disabled && preview.status === "idle"}
              // Loading or playing, the same press stops it; busy says which.
              aria-busy={preview.status === "loading"}
              aria-label={previewLabel}
              title={previewLabel}
            >
              <VoiceAvatar voice={activeVoice} size="large" />
              <span className="voice-preview-badge" aria-hidden="true">
                <PreviewIcon status={preview.status} />
              </span>
            </button>
          ) : (
            <VoiceAvatar voice={activeVoice} size="large" />
          )}
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
            aria-pressed={favorite}
            aria-label={favorite ? t("取消收藏当前声音") : t("收藏当前声音")}
          >
            <StarIcon filled={favorite} />
            <span>{favorite ? t("已收藏") : t("加入收藏")}</span>
          </button>
        </div>
      )}

      {activeVoice && preview?.error && (
        <div className="inline-alert" role="alert">
          {t(preview.error)}
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
            disabled={noCatalog}
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
            disabled={noCatalog}
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
          busy={catalogStatus === "loading"}
          emptyMessage={emptyMessage}
        />
      )}
    </section>
  );
}
