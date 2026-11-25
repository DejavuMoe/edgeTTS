import { LANGUAGE_OPTIONS, useI18n, type UiLocale } from "../i18n.js";
import { Select } from "../ui/index.js";
import type { ApiStatus } from "./useWorkbenchConnection.js";

const STATUS_LABELS = {
  loading: "连接中...",
  healthy: "正常",
  unavailable: "不可用",
} as const;

/** The project's source code, issues and releases. */
export const REPOSITORY_URL = "https://github.com/DejavuMoe/edgeTTS";

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
        {/* A new tab keeps the draft and the take; noopener isolates this page from GitHub. */}
        <a
          className="header-link"
          href={REPOSITORY_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("在 GitHub 查看源代码")}
          title={t("在 GitHub 查看源代码")}
        >
          <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
          </svg>
        </a>
      </div>
    </header>
  );
}
