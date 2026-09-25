import { useI18n } from "../i18n.js";
import { formatResultMetadataDisplay, formatResultSummary } from "../lib/result-metadata.js";
import { formatGeneratingStatusText } from "../lib/synthesis-telemetry.js";
import { shortVoiceName } from "../lib/voice-names.js";
import { AudioPlayer } from "../ui/index.js";
import type { useSynthesis } from "./useSynthesis.js";

export interface ResultPanelProps {
  readonly synthesis: ReturnType<typeof useSynthesis>;
}

/**
 * What the synthesize action produced, directly below the text it was made from: progress
 * while it runs, then the take as a playable track with its voice, settings and download.
 * Before the first synthesis there is nothing to show, so the panel takes no space.
 */
export function ResultPanel({ synthesis }: ResultPanelProps) {
  const { locale, t } = useI18n();
  const { isGenerating, telemetry, error, audioSrc, downloadUrl, completedResult } = synthesis;

  if (!isGenerating && !error && !audioSrc) return null;

  return (
    <section
      className="result"
      aria-label={t("合成结果播放")}
      data-state={isGenerating ? "generating" : audioSrc ? "ready" : "error"}
    >
      <h2 className="visually-hidden">{t("合成结果")}</h2>

      {isGenerating && telemetry && (
        <span className="result-status" role="status" aria-live="polite" aria-label={t("合成状态")}>
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
          className="result-track"
        >
          {completedResult && (
            <div
              className="result-metadata"
              aria-label={t("音频生成信息")}
              title={formatResultMetadataDisplay(completedResult, locale)}
            >
              <span className="result-voice">
                {shortVoiceName({ displayName: completedResult.voiceDisplayName })}
              </span>{" "}
              <span className="result-summary">{formatResultSummary(completedResult, locale)}</span>
            </div>
          )}
        </AudioPlayer>
      )}
    </section>
  );
}
