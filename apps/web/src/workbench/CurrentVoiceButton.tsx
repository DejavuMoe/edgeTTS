import type { VoiceDto } from "@edgetts/shared";
import { useI18n } from "../i18n.js";
import { shortVoiceName } from "../lib/voice-names.js";

export interface CurrentVoiceButtonProps {
  readonly voice: VoiceDto | undefined;
  readonly onClick: () => void;
}

/**
 * The selected voice beside the synthesize button. Shown only on phones, where the voice
 * picker sits far below the text: it says which voice will speak and jumps to the picker.
 */
export function CurrentVoiceButton({ voice, onClick }: CurrentVoiceButtonProps) {
  const { t } = useI18n();
  if (!voice) return null;
  const name = shortVoiceName(voice);
  return (
    <button
      type="button"
      className="current-voice-button"
      onClick={onClick}
      aria-label={t("更换声音（当前：{name}）", { name })}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          d="M8 1.75a2.25 2.25 0 0 0-2.25 2.25v4a2.25 2.25 0 0 0 4.5 0V4A2.25 2.25 0 0 0 8 1.75zM3.75 7.5a4.25 4.25 0 0 0 8.5 0M8 11.75v2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
      <span className="current-voice-button-name">{name}</span>
    </button>
  );
}
