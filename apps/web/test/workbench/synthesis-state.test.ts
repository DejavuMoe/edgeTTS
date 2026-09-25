import { describe, expect, it } from "vitest";
import type { CompletedResultMeta } from "../../src/lib/result-metadata.js";
import {
  INITIAL_SYNTHESIS_STATE,
  synthesisReducer,
  type SynthesisEvent,
  type SynthesisState,
} from "../../src/workbench/synthesis-state.js";

const RESULT: CompletedResultMeta = {
  voiceId: "zh-CN-XiaoxiaoNeural",
  voiceDisplayName: "Xiaoxiao",
  quality: "standard",
  speed: 1,
  pitchSemitones: 0,
  volume: 1,
  completedAt: 0,
  filename: "edgetts.mp3",
  segmentCount: 2,
  audioBytes: 10,
};

function run(events: readonly SynthesisEvent[], from = INITIAL_SYNTHESIS_STATE): SynthesisState {
  return events.reduce(synthesisReducer, from);
}

const STREAMED: SynthesisEvent[] = [
  { type: "started" },
  { type: "planned", plan: { segmentCount: 2, maxSegmentCodePoints: 300 } },
  { type: "streamReady", mediaUrl: "blob:media" },
  { type: "progressed", bytesReceived: 4096 },
];

describe("synthesisReducer", () => {
  it("starts a fresh generation, discarding the previous result and error", () => {
    const previous: SynthesisState = {
      ...INITIAL_SYNTHESIS_STATE,
      error: "网络请求失败",
      audioSrc: "blob:old",
      downloadUrl: "blob:old",
      completedResult: RESULT,
    };
    expect(run([{ type: "started" }], previous)).toEqual({
      ...INITIAL_SYNTHESIS_STATE,
      isGenerating: true,
      telemetry: {
        phase: "requesting",
        segmentCount: null,
        maxSegmentCodePoints: null,
        bytesReceived: 0,
      },
    });
  });

  it("tracks plan, streaming and progress telemetry while generating", () => {
    expect(run(STREAMED)).toEqual({
      ...INITIAL_SYNTHESIS_STATE,
      isGenerating: true,
      audioSrc: "blob:media",
      telemetry: {
        phase: "streaming",
        segmentCount: 2,
        maxSegmentCodePoints: 300,
        bytesReceived: 4096,
      },
    });
  });

  it("keeps the playable result and clears progress when the stream finishes", () => {
    const state = run([
      ...STREAMED,
      { type: "downloadReady", downloadUrl: "blob:download", result: RESULT },
      { type: "finished" },
    ]);
    expect(state).toEqual({
      ...INITIAL_SYNTHESIS_STATE,
      audioSrc: "blob:media",
      downloadUrl: "blob:download",
      completedResult: RESULT,
    });
  });

  it("does not resurrect telemetry after it has been cleared", () => {
    const finished = run([{ type: "started" }, { type: "finished" }]);
    expect(
      run(
        [
          { type: "planned", plan: { segmentCount: 1, maxSegmentCodePoints: 300 } },
          { type: "streamReady", mediaUrl: "blob:late" },
          { type: "progressed", bytesReceived: 1 },
        ],
        finished,
      ).telemetry,
    ).toBeNull();
  });

  it("rejects before audio with an error and no progress", () => {
    expect(run([{ type: "started" }, { type: "rejected", error: "服务当前繁忙" }])).toEqual({
      ...INITIAL_SYNTHESIS_STATE,
      error: "服务当前繁忙",
    });
  });

  it("aborting discards partial playback, downloads and progress", () => {
    const state = run([
      ...STREAMED,
      { type: "downloadReady", downloadUrl: "blob:download", result: RESULT },
      { type: "aborted", error: "已取消生成" },
    ]);
    expect(state).toEqual({ ...INITIAL_SYNTHESIS_STATE, error: "已取消生成" });
  });
});
