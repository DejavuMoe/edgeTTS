import type { MessageKey } from "../i18n.js";
import type { CompletedResultMeta } from "../lib/result-metadata.js";
import type {
  GenerationTelemetryState,
  SynthesisPlanMetadata,
} from "../lib/synthesis-telemetry.js";

export interface SynthesisState {
  readonly isGenerating: boolean;
  readonly error: MessageKey | null;
  /** Playable media URL: a MediaSource URL while streaming, or the completed Blob URL. */
  readonly audioSrc: string | null;
  readonly downloadUrl: string | null;
  readonly completedResult: CompletedResultMeta | null;
  /** Progress while generating; null when idle. */
  readonly telemetry: GenerationTelemetryState | null;
}

export type SynthesisEvent =
  | { readonly type: "started" }
  | { readonly type: "planned"; readonly plan: SynthesisPlanMetadata }
  | { readonly type: "streamReady"; readonly mediaUrl: string }
  | { readonly type: "progressed"; readonly bytesReceived: number }
  | {
      readonly type: "downloadReady";
      readonly downloadUrl: string;
      readonly result: CompletedResultMeta;
    }
  | { readonly type: "finished" }
  /** Rejected before audio (HTTP error or network failure): nothing is playable. */
  | { readonly type: "rejected"; readonly error: MessageKey }
  /** Failed or cancelled after audio may have started: discard partial playback. */
  | { readonly type: "aborted"; readonly error: MessageKey };

export const INITIAL_SYNTHESIS_STATE: SynthesisState = {
  isGenerating: false,
  error: null,
  audioSrc: null,
  downloadUrl: null,
  completedResult: null,
  telemetry: null,
};

/** Telemetry updates apply only while a generation is reporting progress. */
function updateTelemetry(
  state: SynthesisState,
  update: Partial<GenerationTelemetryState>,
): GenerationTelemetryState | null {
  return state.telemetry ? { ...state.telemetry, ...update } : null;
}

export function synthesisReducer(state: SynthesisState, event: SynthesisEvent): SynthesisState {
  switch (event.type) {
    case "started":
      return {
        ...INITIAL_SYNTHESIS_STATE,
        isGenerating: true,
        telemetry: {
          phase: "requesting",
          segmentCount: null,
          maxSegmentCodePoints: null,
          bytesReceived: 0,
        },
      };
    case "planned":
      return {
        ...state,
        telemetry: updateTelemetry(state, {
          segmentCount: event.plan.segmentCount,
          maxSegmentCodePoints: event.plan.maxSegmentCodePoints,
        }),
      };
    case "streamReady":
      return {
        ...state,
        audioSrc: event.mediaUrl,
        telemetry: updateTelemetry(state, { phase: "streaming" }),
      };
    case "progressed":
      return {
        ...state,
        telemetry: updateTelemetry(state, { bytesReceived: event.bytesReceived }),
      };
    case "downloadReady":
      return { ...state, downloadUrl: event.downloadUrl, completedResult: event.result };
    case "finished":
      return { ...state, isGenerating: false, telemetry: null };
    case "rejected":
      return { ...state, isGenerating: false, telemetry: null, error: event.error };
    case "aborted":
      return { ...INITIAL_SYNTHESIS_STATE, error: event.error };
  }
}
