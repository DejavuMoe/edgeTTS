import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export interface AudioPlayerProps {
  src: string;
  downloadUrl?: string | null | undefined;
  downloadFilename?: string | null | undefined;
  className?: string;
  "aria-label"?: string;
}

export const AudioPlayer = forwardRef<HTMLAudioElement, AudioPlayerProps>(function AudioPlayer(
  {
    src,
    downloadUrl,
    downloadFilename,
    className = "",
    "aria-label": ariaLabel = "语音合成播放器",
  },
  ref,
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Forward ref to internal audio element
  useImperativeHandle(ref, () => audioRef.current as HTMLAudioElement);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(NaN);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // Reset state on src change
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(NaN);
  }, [src]);

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

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const targetTime = parseFloat(e.target.value);
    audio.currentTime = targetTime;
    setCurrentTime(targetTime);
  };

  const isDurationFinite = Number.isFinite(duration) && duration > 0;
  const progressPercent = isDurationFinite
    ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
    : 0;

  const formatTime = (secs: number): string => {
    if (!Number.isFinite(secs) || secs < 0) return "--:--";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className={`player-wrapper ${className}`}>
      <div className="audio-player ui-audio-player" role="region" aria-label={ariaLabel}>
        <audio ref={audioRef} src={src} preload="metadata">
          您的浏览器不支持音频播放。
        </audio>

        {/* Play / Pause button */}
        <button
          type="button"
          className="ui-audio-btn ui-audio-play-btn"
          onClick={togglePlay}
          aria-label={isPlaying ? "暂停" : "播放"}
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

        {/* Time display */}
        <span className="ui-audio-time" aria-label="播放时间">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        {/* Seek Bar */}
        <div className="ui-audio-seek-wrap">
          <input
            type="range"
            className="control-slider ui-audio-seek-slider"
            min="0"
            max={isDurationFinite ? duration : 100}
            step="0.05"
            value={isDurationFinite ? currentTime : 0}
            onChange={handleSeek}
            disabled={!isDurationFinite}
            aria-label="音频时间进度条"
            style={
              {
                "--slider-progress": `${progressPercent}%`,
              } as React.CSSProperties
            }
          />
        </div>

        {/* Mute button */}
        <button
          type="button"
          className="ui-audio-btn ui-audio-mute-btn"
          onClick={toggleMute}
          aria-label={isMuted ? "取消静音" : "静音"}
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
          aria-label="下载合成音频"
        >
          下载 MP3
        </a>
      )}
    </div>
  );
});
