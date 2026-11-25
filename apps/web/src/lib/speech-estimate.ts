export type AudioQuality = "standard" | "high";

/**
 * Bytes per second of each quality's MP3. Both are constant bitrate (48 and 96 kbps), so a byte
 * count converts straight to seconds of audio.
 */
export const AUDIO_BYTES_PER_SECOND: Readonly<Record<AudioQuality, number>> = {
  standard: 6000,
  high: 12000,
};

/*
 * Seconds of speech per character at 1.0×, measured from the voices' own output: Chinese,
 * Japanese and Korean read about five characters a second, alphabetic scripts about fourteen
 * letters. Clause and sentence punctuation adds a pause. Spaces, symbols and other marks add
 * nothing of their own. Across zh, ja, ko, en and fr samples this lands within 8% of the
 * real length.
 */
const SECONDS_PER_HAN = 0.2;
const SECONDS_PER_KANA = 0.19;
const SECONDS_PER_HANGUL = 0.19;
const SECONDS_PER_DIGIT = 0.2;
const SECONDS_PER_LETTER = 0.07;
const SECONDS_PER_PAUSE = 0.25;

const HAN = /\p{Script=Han}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL = /\p{Script=Hangul}/u;
const DIGIT = /\p{Nd}/u;
const LETTER = /\p{L}/u;
const PAUSE = /[,.;:!?，。、；：！？…]/u;

function secondsFor(character: string): number {
  if (HAN.test(character)) return SECONDS_PER_HAN;
  if (KANA.test(character)) return SECONDS_PER_KANA;
  if (HANGUL.test(character)) return SECONDS_PER_HANGUL;
  if (DIGIT.test(character)) return SECONDS_PER_DIGIT;
  if (LETTER.test(character)) return SECONDS_PER_LETTER;
  if (PAUSE.test(character)) return SECONDS_PER_PAUSE;
  return 0;
}

/**
 * About how long the text will take to say at the given speed, in seconds; 0 when nothing in it
 * is spoken. An estimate, for showing progress while the audio arrives, never for cutting it off.
 */
export function estimateSpeechSeconds(text: string, speed = 1): number {
  let seconds = 0;
  for (const character of text) seconds += secondsFor(character);
  return seconds > 0 && Number.isFinite(speed) && speed > 0 ? seconds / speed : 0;
}
