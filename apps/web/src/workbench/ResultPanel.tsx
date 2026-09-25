import { useI18n } from "../i18n.js";
import { formatResultMetadataDisplay } from "../result-metadata.js";
import { formatGeneratingStatusText } from "../synthesis-telemetry.js";
import { AudioPlayer } from "../ui/index.js";
import type { useSynthesis } from "./useSynthesis.js";

export function ResultPanel({
  synthesis,
}: {
  readonly synthesis: ReturnType<typeof useSynthesis>;
}) {
  const { locale, t } = useI18n();
  const { isGenerating, telemetry, error, audioSrc, downloadUrl, completedResult } = synthesis;

  return (
    <section className="panel result-panel" aria-label={t("合成结果播放")}>
      <div className="result-header">
        <h2 className="panel-title">{t("合成结果")}</h2>
        {isGenerating && telemetry && (
          <span
            className="generating-indicator"
            role="status"
            aria-live="polite"
            aria-label={t("合成状态")}
          >
            {formatGeneratingStatusText(telemetry, locale)}
          </span>
        )}
      </div>

      {error && (
        <div className="generation-error" role="alert">
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
          <span>{formatResultMetadataDisplay(completedResult, locale)}</span>
        </div>
      )}

      {!audioSrc && !error && !isGenerating && (
        <p className="empty-result-text">{t("输入文本并点击“合成语音”后在此试听与下载。")}</p>
      )}
    </section>
  );
}
