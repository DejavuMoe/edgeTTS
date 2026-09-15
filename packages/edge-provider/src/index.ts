export {
  EdgeTtsProvider,
  MAX_VOICE_ID_LENGTH,
  VOICE_ID_REGEX,
  isValidVoiceId,
  DEFAULT_LIST_VOICES_TIMEOUT_MS,
  DEFAULT_SETUP_TIMEOUT_MS,
  type EdgeTtsProviderOptions,
} from "./edge-provider.js";
export { escapeXmlText } from "./xml.js";
export { toEdgeProsody } from "./prosody.js";
export { defaultEdgeClientFactory, type EdgeClient, type EdgeClientFactory } from "./client.js";
