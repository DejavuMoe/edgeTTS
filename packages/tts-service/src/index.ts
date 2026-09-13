export {
  TtsService,
  DEFAULT_MAX_CONCURRENT_SYNTHESES,
  DEFAULT_MAX_QUEUED_SYNTHESES,
  type TtsServiceOptions,
  type ListVoicesOptions,
  type SegmentedSynthesisOptions,
} from "./tts-service.js";
export { DEFAULT_VOICE_CACHE_TTL_MS, type VoiceCacheOptions } from "./voice-cache.js";
export { SynthesisQueueFullError } from "./synthesis-limiter.js";
export { segmentText, countCodePoints, type TextSegmentationOptions } from "./text-segmenter.js";
