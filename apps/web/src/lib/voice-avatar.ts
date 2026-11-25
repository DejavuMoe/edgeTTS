import type { VoiceDto } from "@edgetts/shared";
import { voicePersona } from "./voice-persona.js";

export type AvatarVoice = Pick<VoiceDto, "id" | "locale" | "gender">;

type Render = (voice: AvatarVoice) => string;

// Moods a speaker would greet you with; Dylan's angry, sad and confused faces are left out.
const MOODS = { happy: 3, hopeful: 2, superHappy: 2 } as const;

/**
 * Drawing one portrait takes about a millisecond, several on a slow phone. Queued portraits are
 * drawn in slices of at most this long, so drawing a whole list never blocks input for long.
 */
export const AVATAR_SLICE_MS = 8;

let render: Render | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const cache = new Map<string, string>();

/** Portraits waiting to be drawn, oldest request first. */
const queue = new Map<string, AvatarVoice>();
const voiceListeners = new Map<string, Set<() => void>>();
let drainScheduled = false;

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
      scheduleDrain();
    },
    () => {
      // Keep the monograms; a later request may try again.
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

/** Identifies a portrait: the persona depends on the locale and gender as well as the id. */
export function voiceAvatarKey(voice: AvatarVoice): string {
  return `${voice.id}\u0000${voice.locale}\u0000${voice.gender}`;
}

/** The voice's portrait as a data URI, drawn now if needed, or null while the renderer loads. */
export function voiceAvatarUri(voice: AvatarVoice): string | null {
  if (!render) return null;
  const key = voiceAvatarKey(voice);
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

/** An already drawn portrait, or null: never draws, so it is cheap enough to call while rendering. */
export function cachedVoiceAvatar(key: string): string | null {
  return cache.get(key) || null;
}

/**
 * Asks for a portrait to be drawn soon. Requests are drawn in idle time slices, oldest first,
 * and each voice's subscribers hear about its portrait once it exists.
 */
export function requestVoiceAvatar(voice: AvatarVoice): void {
  const key = voiceAvatarKey(voice);
  if (cache.has(key) || queue.has(key)) return;
  queue.set(key, voice);
  if (render) scheduleDrain();
  else void loadVoiceAvatars();
}

export function subscribeVoiceAvatar(key: string, listener: () => void): () => void {
  let set = voiceListeners.get(key);
  if (!set) voiceListeners.set(key, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) voiceListeners.delete(key);
  };
}

function scheduleDrain(): void {
  if (drainScheduled || !render || queue.size === 0) return;
  drainScheduled = true;
  if (typeof requestIdleCallback === "function") {
    // The timeout keeps portraits coming while the page stays busy, e.g. during playback.
    requestIdleCallback(drainQueue, { timeout: 200 });
  } else {
    setTimeout(drainQueue, 0);
  }
}

function drainQueue(deadline?: IdleDeadline): void {
  drainScheduled = false;
  const started = performance.now();
  const drawn: string[] = [];
  for (const [key, voice] of queue) {
    queue.delete(key);
    voiceAvatarUri(voice);
    drawn.push(key);
    const idleLeft = deadline && !deadline.didTimeout ? deadline.timeRemaining() : Infinity;
    if (idleLeft <= 0 || performance.now() - started >= AVATAR_SLICE_MS) break;
  }
  // Notified together, so React renders the whole slice as one update.
  for (const key of drawn) {
    for (const listener of voiceListeners.get(key) ?? []) listener();
  }
  scheduleDrain();
}
