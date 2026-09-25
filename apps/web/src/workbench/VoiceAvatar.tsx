import type { CSSProperties } from "react";
import type { VoiceDto } from "@edgetts/shared";
import { voiceHue, voiceInitial } from "../lib/voice-names.js";

/** A voice's monogram in its own stable colour. Decorative: the name is always beside it. */
export function VoiceAvatar({
  voice,
  size = "small",
}: {
  readonly voice: Pick<VoiceDto, "id" | "displayName">;
  readonly size?: "small" | "large";
}) {
  return (
    <span
      className={`voice-avatar voice-avatar-${size}`}
      style={{ "--hue": voiceHue(voice.id) } as CSSProperties}
      aria-hidden="true"
    >
      {voiceInitial(voice)}
    </span>
  );
}
