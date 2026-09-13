import type { TtsVoice } from "@edgetts/tts-core";

export interface TtsServicePort {
  listVoices(): Promise<readonly TtsVoice[]>;
}

export interface AppDependencies {
  readonly ttsService: TtsServicePort;
}
