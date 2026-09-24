export {
  TtsService,
  DEFAULT_MAX_CONCURRENT_SYNTHESES,
  DEFAULT_MAX_QUEUED_SYNTHESES,
  type TtsServiceOptions,
  type ListVoicesOptions,
  type SegmentedSynthesisOptions,
  type SegmentedSynthesisResult,
} from "./tts-service.js";
export {
  DEFAULT_VOICE_CACHE_TTL_MS,
  DEFAULT_VOICE_CACHE_ERROR_BACKOFF_MS,
  type VoiceCacheOptions,
} from "./voice-cache.js";
export { SynthesisQueueFullError } from "./synthesis-limiter.js";
export { segmentText, type TextSegmentationOptions } from "./text-segmenter.js";
export { countCodePoints } from "@edgetts/tts-core";
