import { useWaveform } from "../audio/useWaveform.js";
import { MAX_WAVEFORM_SOURCE_BYTES } from "../audio/waveform.js";
import { useI18n } from "../i18n.js";
import { formatResultMetadataDisplay, formatResultSummary } from "../lib/result-metadata.js";
import {
  formatGeneratingBytesText,
  formatGeneratingPhaseText,
  STATUS_SEPARATOR,
} from "../lib/synthesis-telemetry.js";
import { shortVoiceName } from "../lib/voice-names.js";
import { AudioPlayer } from "../ui/index.js";
import type { RefObject } from "react";
import type { useSynthesis } from "./useSynthesis.js";

/** Bars of the "voice forming" animation shown until the first audio arrives. */
const LIVE_BARS = 160;

export interface ResultPanelProps {
  readonly synthesis: ReturnType<typeof useSynthesis>;
  /** The take's play button, where focus goes when a synthesis finishes. */
  readonly playButtonRef?: RefObject<HTMLButtonElement | null>;
}

/**
 * What the synthesize action produced, directly below the text it was made from: progress
 * while it runs, then the take as a playable track with its voice, settings and download.
 * Before the first synthesis there is nothing to show, so the panel takes no space.
 */
export function ResultPanel({ synthesis, playButtonRef }: ResultPanelProps) {
  const { locale, t } = useI18n();
  const { isGenerating, telemetry, error, audioSrc, downloadUrl, completedResult } = synthesis;
  const peaks = useWaveform(
    completedResult && (completedResult.audioBytes ?? 0) <= MAX_WAVEFORM_SOURCE_BYTES
      ? downloadUrl
      : null,
  );

  const bytesText = telemetry && formatGeneratingBytesText(telemetry);
  // The status line announces itself only when the stage changes; nothing marks the end of a
  // synthesis there, because the line goes away. This region is always present, so a finished
  // take is announced: cancellation and failure already are, by their alerts.
  const announcement = !isGenerating && completedResult && !error ? t("合成完成，可以播放") : "";
  const hasContent = isGenerating || error !== null || audioSrc !== null;

  return (
    <>
      <span className="visually-hidden" role="status">
        {announcement}
      </span>
      {hasContent && (
        <section
          className="result"
          aria-label={t("合成结果播放")}
          data-state={isGenerating ? "generating" : audioSrc ? "ready" : "error"}
        >
          <h2 className="visually-hidden">{t("合成结果")}</h2>

          {isGenerating && telemetry && (
            <span className="result-status" role="status" aria-label={t("合成状态")}>
              <span className="live-dot" aria-hidden="true" />
              {formatGeneratingPhaseText(telemetry, locale)}
              {/* Bytes tick up several times a second: shown, never read out. */}
              {bytesText && <span aria-hidden="true">{`${STATUS_SEPARATOR}${bytesText}`}</span>}
            </span>
          )}

          {isGenerating && !audioSrc && (
            <div className="result-live" aria-hidden="true">
              {Array.from({ length: LIVE_BARS }, (_, index) => (
                <span key={index} style={{ animationDelay: `${((index * 7) % 13) * -95}ms` }} />
              ))}
            </div>
          )}

          {error && (
            <div className="inline-alert generation-error" role="alert">
              {t(error)}
            </div>
          )}

          {audioSrc && (
            <AudioPlayer
              ref={synthesis.audioRef}
              playButtonRef={playButtonRef}
              src={audioSrc}
              downloadUrl={downloadUrl}
              downloadFilename={completedResult?.filename}
              aria-label={t("语音合成播放器")}
              className="result-track"
              peaks={peaks}
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
                  <span className="result-summary">
                    {formatResultSummary(completedResult, locale)}
                  </span>
                </div>
              )}
            </AudioPlayer>
          )}
        </section>
      )}
    </>
  );
}
