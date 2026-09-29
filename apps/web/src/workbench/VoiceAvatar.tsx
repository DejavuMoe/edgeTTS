import { useEffect, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import type { VoiceDto } from "@edgetts/shared";
import {
  loadVoiceAvatars,
  subscribeVoiceAvatars,
  voiceAvatarsReady,
  voiceAvatarUri,
} from "../lib/voice-avatar.js";
import { voiceHue, voiceInitial } from "../lib/voice-names.js";

/**
 * A voice's portrait on its own stable colour, or its monogram until the portraits have
 * loaded. Decorative: the name is always beside it.
 */
export function VoiceAvatar({
  voice,
  size = "small",
}: {
  readonly voice: Pick<VoiceDto, "id" | "displayName" | "locale" | "gender">;
  readonly size?: "small" | "large";
}) {
  const ready = useSyncExternalStore(subscribeVoiceAvatars, voiceAvatarsReady, voiceAvatarsReady);
  useEffect(() => {
    if (!ready) void loadVoiceAvatars();
  }, [ready]);
  const uri = ready ? voiceAvatarUri(voice) : null;

  return (
    <span
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
