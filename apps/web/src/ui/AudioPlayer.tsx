import { useI18n } from "../i18n.js";
import { formatMediaTime as formatTime } from "../lib/media-time.js";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export interface AudioPlayerProps {
  src: string;
  downloadUrl?: string | null | undefined;
  downloadFilename?: string | null | undefined;
  className?: string;
  "aria-label"?: string;
  /** What is playing, shown above the timeline, e.g. the voice and its settings. */
  children?: React.ReactNode;
  /** Loudness per bar (0..1). When present the timeline is drawn as the take's waveform. */
  peaks?: readonly number[] | null | undefined;
  /** The play/pause button, for callers that move focus to it when a take is ready. */
  playButtonRef?: React.Ref<HTMLButtonElement> | undefined;
  /**
   * The take is still arriving, so the media has no duration yet. The timeline spans
   * `expectedDuration` (or what has arrived, when that is longer), marks the part received,
   * and seeks only within it.
   */
  live?: boolean | undefined;
  /** About how long a live take will be, in seconds; unknown when absent. */
  expectedDuration?: number | null | undefined;
  /**
   * Keeps the audio off AirPlay and other remote playback. Safari's ManagedMediaSource streams
   * only to an element that does.
   */
  disableRemotePlayback?: boolean | undefined;
}

/** How often a live take's received length is read while it arrives. */
const LIVE_BUFFER_POLL_MS = 500;

/** Where the audio received so far ends, in seconds. */
function bufferedEndOf(audio: HTMLAudioElement): number {
  const ranges = audio.buffered;
  return ranges && ranges.length > 0 ? ranges.end(ranges.length - 1) : 0;
}

/** Seconds an arrow key moves the timeline; Page Up / Page Down move it further. */
const SEEK_STEP_SECONDS = 5;
const SEEK_PAGE_SECONDS = 30;

const BAR_PITCH = 3;
const BAR_WIDTH = 2;
const WAVE_HEIGHT = 40;

/** One SVG of rounded bars, mirrored around the centre line like a recorder's level trace. */
function WaveformBars({
  peaks,
  className,
  style,
}: {
  peaks: readonly number[];
  className: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={style}
      viewBox={`0 0 ${peaks.length * BAR_PITCH} ${WAVE_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {peaks.map((peak, index) => {
        const height = Math.max(2, peak * WAVE_HEIGHT);
        return (
          <rect
            key={index}
            x={index * BAR_PITCH}
            y={(WAVE_HEIGHT - height) / 2}
            width={BAR_WIDTH}
            height={height}
            rx={1}
          />
        );
      })}
    </svg>
  );
}

export const AudioPlayer = forwardRef<HTMLAudioElement, AudioPlayerProps>(function AudioPlayer(
  {
    src,
    downloadUrl,
    downloadFilename,
    className = "",
    "aria-label": ariaLabel,
    children,
    peaks,
    playButtonRef,
    live = false,
    expectedDuration,
    disableRemotePlayback = false,
  },
  ref,
) {
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Forward ref to internal audio element
  useImperativeHandle(ref, () => audioRef.current as HTMLAudioElement);

  // Set in the commit that adds the element, before the browser starts loading its source.
  useLayoutEffect(() => {
    if (audioRef.current) audioRef.current.disableRemotePlayback = disableRemotePlayback;
  }, [disableRemotePlayback]);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(NaN);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [bufferedEnd, setBufferedEnd] = useState<number>(0);

  // Reset state on src change
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(NaN);
    setBufferedEnd(0);
  }, [src]);

  // A stream fires few events as it grows, so its received length is also read on a timer.
  useEffect(() => {
    const audio = audioRef.current;
    if (!live || !audio) return;
    const update = () => setBufferedEnd(bufferedEndOf(audio));
    update();
    const timer = window.setInterval(update, LIVE_BUFFER_POLL_MS);
    audio.addEventListener("progress", update);
    return () => {
      window.clearInterval(timer);
      audio.removeEventListener("progress", update);
    };
  }, [live, src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleDurationChange = () => setDuration(audio.duration);
    const handleLoadedMetadata = () => setDuration(audio.duration);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const handleVolumeChange = () => setIsMuted(audio.muted);

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("durationchange", handleDurationChange);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("volumechange", handleVolumeChange);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("durationchange", handleDurationChange);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("volumechange", handleVolumeChange);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setIsMuted(audio.muted);
  }, []);

  const isDurationFinite = Number.isFinite(duration) && duration > 0;
  const expectedLength =
    expectedDuration && Number.isFinite(expectedDuration) && expectedDuration > 0
      ? expectedDuration
      : 0;
  // What the timeline spans, and the furthest point a seek may reach: while the take arrives,
  // the expected length and the part received; once complete, the whole take.
  const timelineEnd = live
    ? Math.max(expectedLength, bufferedEnd)
    : isDurationFinite
      ? duration
      : 0;
  const seekEnd = live ? bufferedEnd : timelineEnd;
  const canSeek = seekEnd > 0;

  const seekTo = (targetTime: number) => {
    const audio = audioRef.current;
    if (!audio || !canSeek) return;
    const time = Math.min(seekEnd, Math.max(0, targetTime));
    audio.currentTime = time;
    setCurrentTime(time);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    seekTo(parseFloat(e.target.value));
  };

  // The slider's own step is fine-grained for dragging, which would make each arrow key
  // press move a twentieth of a second. Keys move by steps a listener can hear instead.
  const handleSeekKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio || !canSeek) return;
    const position = audio.currentTime;
    const targets: Record<string, number> = {
      ArrowLeft: position - SEEK_STEP_SECONDS,
      ArrowDown: position - SEEK_STEP_SECONDS,
      ArrowRight: position + SEEK_STEP_SECONDS,
      ArrowUp: position + SEEK_STEP_SECONDS,
      PageDown: position - SEEK_PAGE_SECONDS,
      PageUp: position + SEEK_PAGE_SECONDS,
      Home: 0,
      End: seekEnd,
    };
    const target = targets[e.key];
    if (target === undefined || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    seekTo(target);
  };

  // Where a click on the waveform would seek to, shown while the pointer is over it.
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const trackHover = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverRatio(Math.min(1, Math.max(0, (e.clientX - rect.left) / (rect.width || 1))));
  };
  const percentOfTimeline = (seconds: number): number =>
    timelineEnd > 0 ? Math.min(100, Math.max(0, (seconds / timelineEnd) * 100)) : 0;
  const progressPercent = percentOfTimeline(currentTime);
  const totalText = live
    ? expectedLength > 0
      ? t("约 {time}", { time: formatTime(timelineEnd) })
      : formatTime(NaN)
    : formatTime(duration);

  return (
    <div className={`player-wrapper ${className}`}>
      <div
        className="audio-player ui-audio-player"
        role="region"
        aria-label={ariaLabel ?? t("语音合成播放器")}
      >
        <audio ref={audioRef} src={src} preload="metadata">
          {t("您的浏览器不支持音频播放。")}
        </audio>

        {/* Play / Pause button */}
        <button
          ref={playButtonRef}
          type="button"
          className="ui-audio-btn ui-audio-play-btn"
          onClick={togglePlay}
          aria-label={isPlaying ? t("暂停") : t("播放")}
        >
          {isPlaying ? (
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">
              <polygon points="6 4 20 12 6 20" />
            </svg>
          )}
        </button>

        {/* Title and time above a full-width timeline */}
        <div className="player-main">
          <div className="player-heading">
            <div className="player-title">{children}</div>
            <span className="ui-audio-time" aria-label={t("播放时间")}>
              {formatTime(currentTime)} / {totalText}
            </span>
          </div>
          <div
            className={`ui-audio-seek-wrap ${peaks?.length ? "has-waveform" : ""}`}
            onPointerMove={peaks?.length ? trackHover : undefined}
            onPointerLeave={() => setHoverRatio(null)}
          >
            {peaks?.length && hoverRatio !== null && isDurationFinite ? (
              <span
                className="waveform-hover"
                style={{ left: `${hoverRatio * 100}%` }}
                aria-hidden="true"
              >
                <span className="waveform-hover-time">{formatTime(hoverRatio * duration)}</span>
              </span>
            ) : null}
            {peaks?.length ? (
              <>
                <WaveformBars peaks={peaks} className="waveform waveform-rest" />
                <WaveformBars
                  peaks={peaks}
                  className="waveform waveform-played"
                  // Only the played part of the accent copy shows.
                  style={{ clipPath: `inset(0 ${100 - progressPercent}% 0 0)` }}
                />
              </>
            ) : null}
            <input
              type="range"
              className="control-slider ui-audio-seek-slider"
              min="0"
              max={timelineEnd > 0 ? timelineEnd : 100}
              step="0.05"
              value={timelineEnd > 0 ? Math.min(currentTime, timelineEnd) : 0}
              onChange={handleSeek}
              onKeyDown={handleSeekKeyDown}
              disabled={!canSeek}
              aria-label={t("音频时间进度条")}
              aria-valuetext={
                !canSeek
                  ? undefined
                  : live
                    ? t("已播放 {current}，已接收 {received}", {
                        current: formatTime(currentTime),
                        received: formatTime(bufferedEnd),
                      })
                    : t("已播放 {current}，共 {total}", {
                        current: formatTime(currentTime),
                        total: formatTime(duration),
                      })
              }
              style={
                {
                  "--slider-progress": `${progressPercent}%`,
                  // The part of a live take received so far; seeks stay within it.
                  ...(live ? { "--slider-buffered": `${percentOfTimeline(bufferedEnd)}%` } : {}),
                } as React.CSSProperties
              }
            />
          </div>
        </div>

        {/* Mute button */}
        <button
          type="button"
          className="ui-audio-btn ui-audio-mute-btn"
          onClick={toggleMute}
          aria-label={isMuted ? t("取消静音") : t("静音")}
        >
          {isMuted ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="16"
              height="16"
              aria-hidden="true"
            >
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="16"
              height="16"
              aria-hidden="true"
            >
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          )}
        </button>
      </div>

      {downloadUrl && downloadFilename && (
        <a
          href={downloadUrl}
          download={downloadFilename}
          className="btn btn-download"
          aria-label={t("下载合成音频")}
        >
          {t("下载 MP3")}
        </a>
      )}
    </div>
  );
});
