import { useI18n } from "../i18n.js";
import type { useWorkbenchConnection } from "./useWorkbenchConnection.js";

export function AuthCard({
  auth,
}: {
  readonly auth: ReturnType<typeof useWorkbenchConnection>["auth"];
}) {
  const { t } = useI18n();
  return (
    <div className="auth-card" role="region" aria-label={t("API 认证")}>
      <div className="auth-card-header">
        <span className="auth-card-title">{t("API 需要认证")}</span>
      </div>
      <form
        className="auth-card-form"
        onSubmit={(e) => {
          e.preventDefault();
          void auth.unlock();
        }}
      >
        <input
          type="password"
          className="auth-key-input"
          aria-label="API Key"
          placeholder={t("请输入 API Key")}
          autoComplete="off"
          spellCheck={false}
          value={auth.keyInput}
          onChange={(e) => auth.setKeyInput(e.target.value)}
          disabled={auth.isUnlocking}
        />
        <button
          type="submit"
          className="btn-unlock"
          disabled={auth.isUnlocking || auth.keyInput.length === 0}
        >
          {auth.isUnlocking ? t("验证中...") : t("解锁")}
        </button>
      </form>
      {auth.error && (
        <div className="auth-card-error" role="alert">
          {t(auth.error)}
        </div>
      )}
    </div>
  );
}
