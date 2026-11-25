import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import type { VoiceDto } from "@edgetts/shared";
import {
  cachedVoiceAvatar,
  requestVoiceAvatar,
  subscribeVoiceAvatar,
  voiceAvatarKey,
} from "../lib/voice-avatar.js";
import { voiceHue, voiceInitial } from "../lib/voice-names.js";

/**
 * A voice's portrait on its own stable colour, or its monogram until the portrait is drawn.
 * Portraits are drawn only once the avatar scrolls into view, a few at a time in idle time, so
 * a catalog of hundreds of voices never draws them all in one long task. Decorative: the name
 * is always beside it.
 */
export function VoiceAvatar({
  voice,
  size = "small",
}: {
  readonly voice: Pick<VoiceDto, "id" | "displayName" | "locale" | "gender">;
  readonly size?: "small" | "large";
}) {
  const { id, locale, gender } = voice;
  const key = voiceAvatarKey(voice);
  const subscribe = useCallback(
    (listener: () => void) => subscribeVoiceAvatar(key, listener),
    [key],
  );
  const snapshot = useCallback(() => cachedVoiceAvatar(key), [key]);
  const uri = useSyncExternalStore(subscribe, snapshot, snapshot);
  const frameRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (uri) return;
    const frame = frameRef.current;
    if (!frame || typeof IntersectionObserver === "undefined") {
      requestVoiceAvatar({ id, locale, gender });
      return;
    }
    // Scroll containers clip what counts as visible, so rows below the list's fold wait.
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      requestVoiceAvatar({ id, locale, gender });
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [uri, id, locale, gender]);

  return (
    <span
      ref={frameRef}
      className={`voice-avatar voice-avatar-${size}`}
      style={{ "--hue": voiceHue(voice.id) } as CSSProperties}
      data-portrait={uri ? "" : undefined}
      aria-hidden="true"
    >
      {uri ? (
        <img src={uri} alt="" width={40} height={40} decoding="async" loading="lazy" />
      ) : (
        voiceInitial(voice)
      )}
    </span>
  );
}
