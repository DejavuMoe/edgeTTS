import type { SynthesisRequest, SynthesisResult, TtsVoice } from "@edgetts/tts-core";
import type { SegmentedSynthesisOptions, SegmentedSynthesisResult } from "@edgetts/tts-service";
import type { TtsStatsSource } from "./metrics.js";

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
  /** Optional source of service counters for /api/metrics. */
  readonly serviceStats?: TtsStatsSource;
}
