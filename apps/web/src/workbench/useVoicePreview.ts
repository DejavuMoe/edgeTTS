import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceDto } from "@edgetts/shared";
import { synthesizeSpeech } from "../api/client.js";
import type { MessageKey } from "../i18n.js";
import { voiceSampleText } from "../lib/voice-sample.js";
import type { SidePlayer } from "./useSidePlayer.js";
import { speechErrorMessage } from "./useSynthesis.js";

/** The side player's id for a voice preview. */
export const PREVIEW_SOUND_ID = "preview";
/** Previews kept for replaying without asking the service again: a few seconds each. */
export const MAX_CACHED_PREVIEWS = 16;

export interface PreviewSettings {
  readonly speed: number;
  readonly pitchSemitones: number;
  readonly volume: number;
}

export type PreviewStatus = "idle" | "loading" | "playing";

export interface VoicePreviewOptions {
  /** The voice the preview is of: the selected one. */
  readonly voice: VoiceDto | undefined;
  readonly settings: PreviewSettings;
  readonly player: SidePlayer;
  readonly getApiKey: () => string | undefined;
  readonly onUnauthorized: () => void;
}

/**
 * Plays a short line in the selected voice, with the current speed, pitch and volume, so a
 * voice can be heard before any text is written for it. The line is the voice's own sample,
 * never the user's text. Each preview is kept in memory, so hearing it again is instant.
 */
export function useVoicePreview({
  voice,
  settings,
  player,
  getApiKey,
  onUnauthorized,
}: VoicePreviewOptions) {
  const cacheRef = useRef(new Map<string, string>());
  const abortRef = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const { play, stop: stopPlayer, playingId } = player;

  const cancelLoad = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }, []);

  /** Stops the preview, loading or playing; any other side sound plays on. */
  const stop = useCallback((): void => {
    cancelLoad();
    stopPlayer(PREVIEW_SOUND_ID);
  }, [cancelLoad, stopPlayer]);

  const remember = (key: string, url: string): void => {
    const cache = cacheRef.current;
    cache.set(key, url);
    while (cache.size > MAX_CACHED_PREVIEWS) {
      const [oldestKey, oldestUrl] = cache.entries().next().value as [string, string];
      cache.delete(oldestKey);
      URL.revokeObjectURL(oldestUrl);
    }
  };

  const start = async (target: VoiceDto): Promise<void> => {
    const input = voiceSampleText(target.locale);
    const { speed, pitchSemitones, volume } = settings;
    const key = JSON.stringify([target.id, input, speed, pitchSemitones, volume]);
    const cached = cacheRef.current.get(key);
    if (cached) {
      // Most recently heard last, so the least recently heard leaves the cache first.
      cacheRef.current.delete(key);
      cacheRef.current.set(key, cached);
      play(PREVIEW_SOUND_ID, cached);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    const isCurrent = () => abortRef.current === controller;
    try {
      const response = await synthesizeSpeech(
        { input, voice: target.id, quality: "standard", speed, pitchSemitones, volume },
        controller.signal,
        getApiKey(),
      );
      if (!isCurrent()) return;
      if (!response.ok) {
        if (response.status === 401) onUnauthorized();
        setError(speechErrorMessage(response.status));
        return;
      }
      const audio = await response.blob();
      if (!isCurrent()) return;
      const url = URL.createObjectURL(audio);
      remember(key, url);
      play(PREVIEW_SOUND_ID, url);
    } catch (err: unknown) {
      if (!isCurrent()) return;
      const aborted = err instanceof Error && err.name === "AbortError";
      if (!aborted) setError("网络请求失败");
    } finally {
      if (isCurrent()) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  };

  const status: PreviewStatus = loading
    ? "loading"
    : playingId === PREVIEW_SOUND_ID
      ? "playing"
      : "idle";

  /** Starts the selected voice's preview, or stops it when it is loading or playing. */
  const toggle = (): void => {
    if (status !== "idle") {
      stop();
      return;
    }
    if (!voice) return;
    setError(null);
    player.prime();
    void start(voice);
  };

  // A preview is of the voice it was asked for: choosing another ends it, and its error.
  const voiceId = voice?.id;
  useEffect(() => {
    setError(null);
    return stop;
  }, [voiceId, stop]);

  // The take starting to play ends a preview still loading, so it never cuts in.
  useEffect(() => {
    const onPagePlay = () => {
      if (abortRef.current) cancelLoad();
    };
    document.addEventListener("play", onPagePlay, true);
    return () => document.removeEventListener("play", onPagePlay, true);
  }, [cancelLoad]);

  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    };
  }, []);

  return { status, error, toggle, stop };
}
