// Live latency benchmark for long-text synthesis against the Microsoft Edge service.
//
// Both strategies run through TtsService.synthesizeSegmented on the same fixed text, in
// interleaved runs:
//   per-segment - provider without sessions: one upstream connection per segment
//   session     - the production path: one provider session (connection) per request
//
// Reports time to first byte, inter-segment gaps, total time, upstream clients created and
// simulated playback stall: how long a listener starting at the first byte would wait for
// audio that has not arrived yet.
//
// Usage: pnpm --filter @edgetts/tts-service bench [runs]   (default 3 runs per strategy)
import { defaultEdgeClientFactory, EdgeTtsProvider } from "@edgetts/edge-provider";
import type {
  SynthesisRequest,
  SynthesisResult,
  SynthesisSession,
  SynthesisSessionOptions,
  TtsProvider,
  TtsVoice,
} from "@edgetts/tts-core";
import { TtsService } from "../src/index.js";

const VOICE = "zh-CN-XiaoxiaoNeural";
const SEGMENT_CODE_POINTS = 300; // matches the HTTP routes
// mp3-48k is constant bitrate, so bytes convert directly to audio duration.
const BYTES_PER_AUDIO_SECOND = 48_000 / 8;

const PARAGRAPH =
  "长文本合成会先按段落、换行、句子和空白切分成不超过三百个码点的片段，再依次交给上游服务。" +
  "每个片段都需要建立连接、发送配置并等待第一段音频返回，这部分等待决定了片段之间的停顿。" +
  "The benchmark measures how long listeners would wait between segments, not audio quality. ";
const TEXT = Array.from({ length: 8 }, () => PARAGRAPH).join("\n\n");

type Strategy = "per-segment" | "session";

interface SegmentTiming {
  firstByteAt: number | null;
  endAt: number | null;
  bytes: number;
  /** Arrival time (relative to the run start) and size of each chunk. */
  readonly chunks: { at: number; bytes: number }[];
}

/** Records every segment's audio timeline; exposes sessions only when asked to. */
class TimingProvider implements TtsProvider {
  readonly timings: SegmentTiming[] = [];
  readonly openSession?: (
    options: SynthesisSessionOptions,
    signal: AbortSignal,
  ) => Promise<SynthesisSession>;

  constructor(
    private readonly inner: EdgeTtsProvider,
    private readonly start: number,
    useSessions: boolean,
  ) {
    if (useSessions) {
      this.openSession = async (options, signal) => {
        const session = await inner.openSession(options, signal);
        return {
          synthesize: (request, segmentSignal) =>
            this.record(session.synthesize(request, segmentSignal)),
          close: () => session.close(),
        };
      };
    }
  }

  listVoices(): Promise<readonly TtsVoice[]> {
    return this.inner.listVoices();
  }

  synthesize(request: SynthesisRequest, signal: AbortSignal): Promise<SynthesisResult> {
    return this.record(this.inner.synthesize(request, signal));
  }

  private async record(pending: Promise<SynthesisResult>): Promise<SynthesisResult> {
    const timing: SegmentTiming = { firstByteAt: null, endAt: null, bytes: 0, chunks: [] };
    this.timings.push(timing);
    const result = await pending;
    const start = this.start;
    return {
      ...result,
      audio: (async function* () {
        for await (const chunk of result.audio) {
          const at = performance.now() - start;
          timing.firstByteAt ??= at;
          timing.bytes += chunk.byteLength;
          timing.chunks.push({ at, bytes: chunk.byteLength });
          yield chunk;
        }
        timing.endAt = performance.now() - start;
      })(),
    };
  }
}

interface Summary {
  readonly ttfbMs: number;
  readonly totalMs: number;
  readonly audioSeconds: number;
  readonly gapMs: { readonly mean: number; readonly max: number };
  readonly stallMs: number;
  readonly clients: number;
  readonly segments: number;
}

async function run(strategy: Strategy): Promise<Summary> {
  const start = performance.now();
  let clients = 0;
  const edge = new EdgeTtsProvider({
    clientFactory: () => {
      clients++;
      return defaultEdgeClientFactory();
    },
  });
  const provider = new TimingProvider(edge, start, strategy === "session");
  const service = new TtsService(provider);
  const result = await service.synthesizeSegmented(
    { text: TEXT, voice: VOICE, format: "mp3-48k" },
    new AbortController().signal,
    { maxSegmentCodePoints: SEGMENT_CODE_POINTS },
  );
  for await (const chunk of result.audio) void chunk;
  return summarize(provider.timings, clients);
}

/**
 * Chunks are delivered in order, so a chunk is playable once it and everything before it has
 * arrived. Playback starts at the first byte and proceeds in real time.
 */
function summarize(segments: readonly SegmentTiming[], clients: number): Summary {
  let deliveredUntil = 0;
  const playable: { at: number; seconds: number }[] = [];
  for (const segment of segments) {
    for (const chunk of segment.chunks) {
      deliveredUntil = Math.max(deliveredUntil, chunk.at);
      playable.push({ at: deliveredUntil, seconds: chunk.bytes / BYTES_PER_AUDIO_SECOND });
    }
  }

  const playbackStart = playable[0]?.at ?? 0;
  let audioRunsOutAt = playbackStart;
  let stall = 0;
  for (const chunk of playable) {
    if (chunk.at > audioRunsOutAt) {
      stall += chunk.at - audioRunsOutAt;
      audioRunsOutAt = chunk.at;
    }
    audioRunsOutAt += chunk.seconds * 1000;
  }

  const gaps: number[] = [];
  for (let index = 1; index < segments.length; index++) {
    const previousEnd = segments[index - 1]!.endAt ?? 0;
    gaps.push(Math.max(0, (segments[index]!.firstByteAt ?? previousEnd) - previousEnd));
  }

  const bytes = segments.reduce((sum, segment) => sum + segment.bytes, 0);
  return {
    ttfbMs: playbackStart,
    totalMs: deliveredUntil,
    audioSeconds: bytes / BYTES_PER_AUDIO_SECOND,
    gapMs: {
      mean: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0,
      max: gaps.length ? Math.max(...gaps) : 0,
    },
    stallMs: stall,
    clients,
    segments: segments.length,
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

async function main(): Promise<void> {
  const runs = Number(process.argv[2] ?? "3");
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) {
    throw new RangeError("runs must be an integer between 1 and 10");
  }
  console.log(`text: ${TEXT.length} UTF-16 units, ${runs} runs per strategy`);

  const summaries = new Map<Strategy, Summary[]>();
  for (let index = 1; index <= runs; index++) {
    // Interleave strategies so upstream variance affects both alike.
    for (const strategy of ["per-segment", "session"] as const) {
      const summary = await run(strategy);
      summaries.set(strategy, [...(summaries.get(strategy) ?? []), summary]);
      console.log(`run ${index} ${strategy}: ${JSON.stringify(summary)}`);
    }
  }

  console.log("\nmedian per strategy (ms unless noted)");
  console.table(
    Object.fromEntries(
      [...summaries].map(([strategy, list]) => [
        strategy,
        {
          ttfb: Math.round(median(list.map((s) => s.ttfbMs))),
          gapMean: Math.round(median(list.map((s) => s.gapMs.mean))),
          gapMax: Math.round(median(list.map((s) => s.gapMs.max))),
          stall: Math.round(median(list.map((s) => s.stallMs))),
          total: Math.round(median(list.map((s) => s.totalMs))),
          audioSec: Number(median(list.map((s) => s.audioSeconds)).toFixed(1)),
          segments: median(list.map((s) => s.segments)),
          clients: median(list.map((s) => s.clients)),
        },
      ]),
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
