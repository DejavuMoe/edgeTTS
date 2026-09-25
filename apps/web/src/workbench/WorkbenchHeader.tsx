import { LANGUAGE_OPTIONS, useI18n, type UiLocale } from "../i18n.js";
import { Select } from "../ui/index.js";
import type { ApiStatus } from "./useWorkbenchConnection.js";

export function WorkbenchHeader({ apiStatus }: { readonly apiStatus: ApiStatus }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <header className="app-header">
      <div className="header-brand">
        <h1 className="brand-title">EdgeTTS</h1>
        <span className="brand-badge">{t("Workbench")}</span>
      </div>
      <div className="header-tools">
        <div className="language-control">
          <Select
            options={LANGUAGE_OPTIONS}
            value={locale}
            onChange={(value) => setLocale(value as UiLocale)}
            aria-label={t("界面语言")}
          />
        </div>
        <div className="header-status">
          <span className="status-label">{t("API 状态")}</span>
          <span
            className="header-status-value"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-label={t("API 状态")}
          >
            {apiStatus === "loading" && (
              <span className="status-badge status-loading">{t("连接中...")}</span>
            )}
            {apiStatus === "healthy" && (
              <span className="status-badge status-healthy">{t("正常")}</span>
            )}
            {apiStatus === "unavailable" && (
              <span className="status-badge status-unavailable">{t("不可用")}</span>
            )}
          </span>
        </div>
      </div>
    </header>
  );
}
