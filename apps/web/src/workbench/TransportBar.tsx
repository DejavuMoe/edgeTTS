import { useI18n } from "../i18n.js";
import { formatResultMetadataDisplay } from "../lib/result-metadata.js";
import { formatGeneratingStatusText } from "../lib/synthesis-telemetry.js";
import { AudioPlayer } from "../ui/index.js";
import type { useSynthesis } from "./useSynthesis.js";

export interface TransportBarProps {
  readonly synthesis: ReturnType<typeof useSynthesis>;
  readonly canGenerate: boolean;
  readonly onGenerate: () => void;
}

/**
 * Pinned to the bottom of the workbench: the primary action sits next to what it produces,
 * so progress, errors and the finished take are always in view.
 */
export function TransportBar({ synthesis, canGenerate, onGenerate }: TransportBarProps) {
  const { locale, t } = useI18n();
  const { isGenerating, telemetry, error, audioSrc, downloadUrl, completedResult } = synthesis;

  return (
    <section
      className="transport"
      aria-label={t("合成结果播放")}
      data-state={isGenerating ? "generating" : audioSrc ? "ready" : error ? "error" : "idle"}
    >
      <h2 className="visually-hidden">{t("合成结果")}</h2>

      <div className="transport-actions action-buttons">
        <button
          type="button"
          className="btn btn-primary btn-synthesize"
          onClick={onGenerate}
          disabled={!canGenerate}
        >
          {isGenerating ? t("正在合成...") : t("合成语音")}
        </button>
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
      </div>

      <div className="transport-body">
        {isGenerating && telemetry && (
          <span
            className="transport-status"
            role="status"
            aria-live="polite"
            aria-label={t("合成状态")}
          >
            <span className="live-dot" aria-hidden="true" />
            {formatGeneratingStatusText(telemetry, locale)}
          </span>
        )}

        {error && (
          <div className="inline-alert generation-error" role="alert">
            {t(error)}
          </div>
        )}

        {audioSrc && (
          <AudioPlayer
            ref={synthesis.audioRef}
            src={audioSrc}
            downloadUrl={downloadUrl}
            downloadFilename={completedResult?.filename}
            aria-label={t("语音合成播放器")}
          />
        )}

        {audioSrc && completedResult && (
          <div className="result-metadata" aria-label={t("音频生成信息")}>
            {formatResultMetadataDisplay(completedResult, locale)}
          </div>
        )}

        {!audioSrc && !error && !isGenerating && (
          <p className="transport-empty">{t("输入文本并点击“合成语音”后在此试听与下载。")}</p>
        )}
      </div>
    </section>
  );
}
