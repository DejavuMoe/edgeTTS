import { useCallback, useEffect, useRef, useState } from "react";

export interface SidePlayer {
  /** What is playing: a caller's own id for the sound, or null when nothing is. */
  readonly playingId: string | null;
  /** Plays `url` as `id`, replacing whatever the side player was playing. */
  readonly play: (id: string, url: string) => void;
  /** Stops the side player; given an id, only when that sound is the one playing. */
  readonly stop: (id?: string) => void;
  /**
   * Readies playback inside a user gesture, for a sound that is played only after it loads:
   * Safari lets an element play later once it has been started from a click or a tap.
   */
  readonly prime: () => void;
}

/** Pauses the page's own players, so only one sound plays at a time. */
function pausePagePlayers(): void {
  for (const element of document.querySelectorAll("audio")) {
    if (!element.paused) element.pause();
  }
}

/**
 * Plays short sounds beside the take, such as voice previews and earlier takes, through one
 * audio element kept out of the page. Only one sound plays at a time: starting one here pauses
 * the take, and playing the take stops this one.
 */
export function useSidePlayer(): SidePlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingIdRef = useRef<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const settle = useCallback((id: string | null): void => {
    playingIdRef.current = id;
    setPlayingId(id);
  }, []);

  const element = useCallback((): HTMLAudioElement => {
    if (audioRef.current) return audioRef.current;
    const audio = new Audio();
    audio.preload = "auto";
    const finished = () => {
      // A pause that comes from replacing the sound is not the end of the new one.
      if (audio.paused) settle(null);
    };
    audio.addEventListener("ended", finished);
    audio.addEventListener("pause", finished);
    audio.addEventListener("error", () => settle(null));
    audioRef.current = audio;
    return audio;
  }, [settle]);

  const stop = useCallback(
    (id?: string): void => {
      if (id !== undefined && playingIdRef.current !== id) return;
      const audio = audioRef.current;
      if (audio && !audio.paused) audio.pause();
      settle(null);
    },
    [settle],
  );

  const play = useCallback(
    (id: string, url: string): void => {
      const audio = element();
      pausePagePlayers();
      if (!audio.paused) audio.pause();
      audio.src = url;
      settle(id);
      audio.play().catch(() => {
        // Blocked or unplayable: nothing is playing, so the control goes back to rest.
        if (playingIdRef.current === id) settle(null);
      });
    },
    [element, settle],
  );

  const prime = useCallback((): void => {
    const audio = element();
    if (audio.paused && !audio.getAttribute("src")) {
      try {
        audio.load();
      } catch {
        // Nothing to ready; playback is attempted all the same.
      }
    }
  }, [element]);

  // The take starting to play stops this one. A detached element's events never reach the
  // document, so every play seen here is the page's own.
  useEffect(() => {
    const onPagePlay = () => {
      if (playingIdRef.current !== null) stop();
    };
    document.addEventListener("play", onPagePlay, true);
    return () => document.removeEventListener("play", onPagePlay, true);
  }, [stop]);

  useEffect(
    () => () => {
      const audio = audioRef.current;
      if (audio) {
        if (!audio.paused) audio.pause();
        audio.removeAttribute("src");
      }
      playingIdRef.current = null;
    },
    [],
  );

  return { playingId, play, stop, prime };
}
