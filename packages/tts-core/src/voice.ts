export const MAX_VOICE_ID_LENGTH = 128;
export const VOICE_ID_REGEX = /^[A-Za-z0-9_-]+$/;

/**
 * Voice identifiers are embedded in provider requests, so they are restricted to a short,
 * markup-safe alphabet. Callers validate at their boundary; providers re-check independently.
 */
export function isValidVoiceId(voice: unknown): voice is string {
  return (
    typeof voice === "string" &&
    voice.length > 0 &&
    voice.length <= MAX_VOICE_ID_LENGTH &&
    VOICE_ID_REGEX.test(voice)
  );
}
