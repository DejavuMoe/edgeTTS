import { useId } from "react";
import { translate, useI18n, type UiLocale } from "../i18n.js";
import { formatMediaTime } from "../lib/media-time.js";
import { formatResultMetadataDisplay } from "../lib/result-metadata.js";
import { AUDIO_BYTES_PER_SECOND } from "../lib/speech-estimate.js";
import { shortVoiceName } from "../lib/voice-names.js";
import type { RecentTake } from "./useRecentTakes.js";
import type { SidePlayer } from "./useSidePlayer.js";

export interface RecentTakesProps {
  /** Earlier takes, newest first; the current one is the main player's. */
  readonly takes: readonly RecentTake[];
  readonly player: SidePlayer;
}

/**
 * What tells one take from another: its voice, then the settings that differ from the
 * defaults, its length and the time it was made.
 */
function describeTake(take: RecentTake, locale: UiLocale): { voice: string; details: string } {
  const { result } = take;
  const details = [`${result.speed.toFixed(2)}×`];
  if (result.pitchSemitones !== 0) {
    const sign = result.pitchSemitones > 0 ? "+" : "";
    details.push(translate("{value}半音", locale, { value: `${sign}${result.pitchSemitones}` }));
  }
  if (result.volume !== 1) {
    details.push(translate("{value}%音量", locale, { value: Math.round(result.volume * 100) }));
  }
  if (result.quality === "high") details.push(translate("高品质", locale));
  details.push(formatMediaTime(take.bytes / AUDIO_BYTES_PER_SECOND[result.quality]));
  details.push(
    new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
      result.completedAt,
    ),
  );
  return {
    voice: shortVoiceName({ displayName: result.voiceDisplayName }),
    details: details.join(" · "),
  };
}

/**
 * The takes before this one, to play against it and download. Each plays beside the take, one
 * sound at a time, and the list keeps only the last few.
 */
export function RecentTakes({ takes, player }: RecentTakesProps) {
  const { locale, t } = useI18n();
  const titleId = useId();
  if (takes.length === 0) return null;

  return (
    <div className="recent-takes">
      <h3 id={titleId} className="recent-takes-title">
        {t("之前的结果")}
      </h3>
      <ul className="recent-takes-list" aria-labelledby={titleId}>
        {takes.map((take) => {
          const { voice, details } = describeTake(take, locale);
          const name = `${voice} ${details}`;
          const playing = player.playingId === take.id;
          return (
            <li key={take.id} className={`recent-take ${playing ? "is-playing" : ""}`}>
              <button
                type="button"
                className="recent-take-play"
                onClick={() => (playing ? player.stop(take.id) : player.play(take.id, take.url))}
                aria-label={
                  playing ? t("停止播放 {take}", { take: name }) : t("播放 {take}", { take: name })
                }
                title={formatResultMetadataDisplay(take.result, locale)}
              >
                {playing ? (
                  <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
                    <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
                    <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
                  </svg>
                )}
                <span className="recent-take-voice">{voice}</span>
                <span className="recent-take-details">{details}</span>
              </button>
              <a
                className="recent-take-download"
                href={take.url}
                download={take.result.filename}
                aria-label={t("下载 {take}", { take: name })}
                title={t("下载 MP3")}
              >
                <svg
                  viewBox="0 0 16 16"
                  width="13"
                  height="13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
                </svg>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
