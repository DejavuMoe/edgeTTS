export type {
  TtsAudioFormat,
  TtsProsody,
  TtsVoice,
  SynthesisRequest,
  SynthesisResult,
  TtsProvider,
} from "./provider.js";
export { TtsError, isTtsError, createAbortError, type TtsErrorCode } from "./errors.js";
export { countCodePoints } from "./text.js";
export { MAX_VOICE_ID_LENGTH, VOICE_ID_REGEX, isValidVoiceId } from "./voice.js";
