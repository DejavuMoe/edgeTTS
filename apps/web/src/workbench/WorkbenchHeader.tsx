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
        edge<span className="brand-accent">TTS</span>
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
