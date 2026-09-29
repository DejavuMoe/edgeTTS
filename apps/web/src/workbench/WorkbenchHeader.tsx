import { LANGUAGE_OPTIONS, useI18n, type UiLocale } from "../i18n.js";
import { Select } from "../ui/index.js";
import type { ApiStatus } from "./useWorkbenchConnection.js";

const STATUS_LABELS = {
  loading: "连接中...",
  healthy: "正常",
  unavailable: "不可用",
} as const;

export function WorkbenchHeader({ apiStatus }: { readonly apiStatus: ApiStatus }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <header className="app-header">
      <h1 className="brand">
        {/* Three lines of text, the middle one breaking into a waveform: text becoming speech. */}
        <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
          <path className="brand-mark-text" d="M3 5.5H10.5M3 18.5H13" />
          <path
            className="brand-mark-voice"
            d="M3 12H8C10 12 9.8 7.6 11.9 7.6C14.2 7.6 14.1 16.4 16.4 16.4C18.4 16.4 18.2 12 20.2 12H21"
          />
        </svg>
        <span>
          edge<span className="brand-suffix">TTS</span>
        </span>
      </h1>
      <div className="header-tools">
        <span
          className="api-status"
          data-state={apiStatus}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={t("API 状态")}
        >
          <span className="status-dot" aria-hidden="true" />
          <span className="status-label">{t("API 状态")}</span>
          <span className="status-value">{t(STATUS_LABELS[apiStatus])}</span>
        </span>
        <div className="language-control">
          <Select
            options={LANGUAGE_OPTIONS}
            value={locale}
            onChange={(value) => setLocale(value as UiLocale)}
            aria-label={t("界面语言")}
          />
        </div>
      </div>
    </header>
  );
}
