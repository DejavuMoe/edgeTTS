import { useI18n } from "../i18n.js";
import type { useSynthesis } from "./useSynthesis.js";

export interface SynthesisActionsProps {
  readonly synthesis: ReturnType<typeof useSynthesis>;
  readonly canGenerate: boolean;
  readonly onGenerate: () => void;
}

/** The synthesize action, and cancel while it runs. Sits at the end of the text it submits. */
export function SynthesisActions({ synthesis, canGenerate, onGenerate }: SynthesisActionsProps) {
  const { t } = useI18n();
  const { isGenerating } = synthesis;

  return (
    <div className="synthesis-actions action-buttons">
      {isGenerating && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={synthesis.cancel}
          aria-label={t("取消合成")}
          aria-keyshortcuts="Escape"
        >
          {t("取消")}
        </button>
      )}
      <button
        type="button"
        className="btn btn-primary btn-synthesize"
        onClick={onGenerate}
        disabled={!canGenerate}
        aria-keyshortcuts="Control+Enter Meta+Enter"
      >
        {isGenerating ? t("正在合成...") : t("合成语音")}
      </button>
    </div>
  );
}
