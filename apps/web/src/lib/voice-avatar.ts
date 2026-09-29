import type { VoiceDto } from "@edgetts/shared";
import { voicePersona } from "./voice-persona.js";

export type AvatarVoice = Pick<VoiceDto, "id" | "locale" | "gender">;

type Render = (voice: AvatarVoice) => string;

// Moods a speaker would greet you with; Dylan's angry, sad and confused faces are left out.
const MOODS = { happy: 3, hopeful: 2, superHappy: 2 } as const;

let render: Render | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const cache = new Map<string, string>();

/**
 * Loads DiceBear and the Dylan style in their own chunk on first use, so the first paint never
 * waits for them; monograms stand in until then, and for good if the chunk fails to load.
 */
export function loadVoiceAvatars(): Promise<void> {
  loading ??= Promise.all([import("@dicebear/core"), import("@dicebear/styles/dylan.json")]).then(
    ([{ Avatar, Style }, { default: definition }]) => {
      const style = new Style(definition);
      render = (voice) => {
        const persona = voicePersona(voice);
        return new Avatar(style, {
          seed: voice.id,
          // Transparent: the frame behind the portrait carries the voice's colour.
          backgroundColor: [],
          skinColor: persona.skinColors,
          hairColor: persona.hairColors,
          hairVariant: persona.hairStyles,
          moodVariant: MOODS,
          facialHairProbability: persona.facialHairProbability,
        }).toDataUri();
      };
      for (const listener of listeners) listener();
    },
    () => {
      // Keep the monograms; a later mount may try again.
      loading = null;
    },
  );
  return loading;
}

export function subscribeVoiceAvatars(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function voiceAvatarsReady(): boolean {
  return render !== null;
}

/** The voice's portrait as a data URI, or null while the renderer is loading. */
export function voiceAvatarUri(voice: AvatarVoice): string | null {
  if (!render) return null;
  const key = `${voice.id}\u0000${voice.locale}\u0000${voice.gender}`;
  let uri = cache.get(key);
  if (uri === undefined) {
    try {
      uri = render(voice);
    } catch {
      uri = "";
    }
    cache.set(key, uri);
  }
  return uri || null;
}
