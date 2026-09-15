import type { SynthesisRequest, SynthesisResult, TtsVoice } from "@edgetts/tts-core";
import type { SegmentedSynthesisOptions, SegmentedSynthesisResult } from "@edgetts/tts-service";

export interface TtsServicePort {
  listVoices(): Promise<readonly TtsVoice[]>;
  synthesize(request: SynthesisRequest, signal: AbortSignal): Promise<SynthesisResult>;
  synthesizeSegmented(
    request: SynthesisRequest,
    signal: AbortSignal,
    options: SegmentedSynthesisOptions,
  ): Promise<SegmentedSynthesisResult>;
}

export interface AppDependencies {
  readonly ttsService: TtsServicePort;
}
