// Run from /app through stdin: docker run --rm -i IMAGE bun run - < this-file
import assert from "node:assert/strict";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { log } from "node:console";

const started = performance.now();
const { TtsService } = await import("@edgetts/tts-service");
const { createApp } = await import("./dist/app.js");
const voices = Array.from({ length: 1000 }, (_, index) => ({
  id: `en-US-Voice${index}Neural`,
  displayName: `Voice ${index}`,
  locale: "en-US",
  gender: "Female",
}));
const audio = new Uint8Array(128);
const provider = {
  listVoices: async () => voices,
  synthesize: async () => ({
    format: "mp3-48k",
    contentType: "audio/mpeg",
    audio: (async function* () {
      yield audio;
    })(),
  }),
};
const service = new TtsService(provider);
const app = createApp({ ttsService: service }, { logger: false, requireApiKey: false });
await app.ready();
const readyMs = performance.now() - started;
const idleRss = process.memoryUsage().rss;
const signal = new globalThis.AbortController().signal;
const results = {};
let bytes = 0;
try {
  assert.equal((await app.inject("/health")).statusCode, 200);
  for (const catalogSize of [320, 1000]) {
    const catalog = voices.slice(0, catalogSize);
    // Use a separate service so each measured catalog has its stated size.
    const measured = new TtsService({
      ...provider,
      listVoices: async () => catalog,
    });
    await measured.listVoices();
    const request = { text: "hello", voice: catalog.at(-1).id.toUpperCase() };
    async function batch() {
      for (let i = 0; i < 1000; i++) {
        const result = await measured.synthesize(request, signal);
        for await (const chunk of result.audio) bytes += chunk.length;
      }
    }
    for (let i = 0; i < 5; i++) await batch();
    const samples = [];
    const cpu = process.cpuUsage();
    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      await batch();
      samples.push(performance.now() - start);
    }
    const used = process.cpuUsage(cpu);
    samples.sort((a, b) => a - b);
    results[catalogSize] = {
      p50Us: samples[24],
      p95Us: samples[47],
      cpuMs: (used.user + used.system) / 1000,
    };
    assert.equal(measured.getStats().activeSyntheses, 0);
    assert.equal(measured.getStats().queuedSyntheses, 0);
  }
  assert.equal(bytes, 2 * 55 * 1000 * 128);
  log(
    JSON.stringify({
      variant: process.env["BENCH_VARIANT"],
      run: process.env["BENCH_RUN"],
      runtime: process.versions.bun,
      readyMs,
      idleRss,
      rss: process.memoryUsage().rss,
      peakRssKiB: Number(readFileSync("/proc/self/status", "utf8").match(/VmHWM:\s+(\d+)/)[1]),
      results,
    }),
  );
} finally {
  await app.close();
}
