import { performance } from "node:perf_hooks";
import { segmentText } from "../src/text-segmenter.js";

// CPU-only microbenchmark: no upstream calls, and no timing assertions in CI.
const workloads = {
  short: "Hello，欢迎使用 edgeTTS。".repeat(8),
  boundary: "中".repeat(300),
  astral: "😀".repeat(300),
  long: "Hello，欢迎使用 edgeTTS。".repeat(1000),
};
const results: Record<string, { p50Us: number; p95Us: number; p99Us: number }> = {};
let consumed = 0;
for (const [name, text] of Object.entries(workloads)) {
  const iterations = text.length > 1000 ? 100 : 1000;
  for (let i = 0; i < 1000; i++) consumed += segmentText(text, { maxCodePoints: 300 }).length;
  const samples: number[] = [];
  for (let batch = 0; batch < 100; batch++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      consumed += segmentText(text, { maxCodePoints: 300 }).length;
    }
    samples.push(((performance.now() - start) * 1000) / iterations);
  }
  samples.sort((a, b) => a - b);
  results[name] = {
    p50Us: Number(samples[49]!.toFixed(3)),
    p95Us: Number(samples[94]!.toFixed(3)),
    p99Us: Number(samples[98]!.toFixed(3)),
  };
}
console.log(
  JSON.stringify(
    { node: process.version, unit: "microseconds/call (batch means)", results, consumed },
    null,
    2,
  ),
);
