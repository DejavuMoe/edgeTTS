import type { TtsProsody } from "@edgetts/tts-core";

export interface EdgeProsody {
  readonly rate: number;
  readonly pitch: string;
  readonly volume: number;
}

function formatPitch(semitones: number): string {
  if (Object.is(semitones, -0) || semitones === 0) {
    return "+0st";
  }
  return semitones > 0 ? `+${semitones}st` : `${semitones}st`;
}

function formatVolume(volume: number): number {
  return Math.round(volume * 1e6 * 100) / 1e6;
}

export function toEdgeProsody(prosody?: TtsProsody): EdgeProsody {
  const speed = prosody?.speed ?? 1.0;
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2.0) {
    throw new RangeError("speed must be between 0.5 and 2");
  }

  const pitchSemitones = prosody?.pitchSemitones ?? 0;
  if (!Number.isFinite(pitchSemitones) || pitchSemitones < -12 || pitchSemitones > 12) {
    throw new RangeError("pitchSemitones must be between -12 and 12");
  }

  const volume = prosody?.volume ?? 1.0;
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw new RangeError("volume must be between 0 and 1");
  }

  return { rate: speed, pitch: formatPitch(pitchSemitones), volume: formatVolume(volume) };
}
