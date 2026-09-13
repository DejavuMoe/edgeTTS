import type { SynthesisRequest, SynthesisResult, TtsVoice } from "@edgetts/tts-core";

export interface TtsServicePort {
  listVoices(): Promise<readonly TtsVoice[]>;
  synthesize(request: SynthesisRequest, signal: AbortSignal): Promise<SynthesisResult>;
}

export interface AppDependencies {
  readonly ttsService: TtsServicePort;
}
