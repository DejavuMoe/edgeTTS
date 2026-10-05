// Run through stdin in the final image, without network access or source-tree mounts:
// docker run --rm -i --network none edgetts:ci bun run - < tests/docker-runtime.mjs
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { log } from "node:console";
import { accessSync, constants, readFileSync } from "node:fs";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { rootCertificates } from "node:tls";
import { TtsService } from "@edgetts/tts-service";
import { createApp } from "./dist/app.js";
import { createProductionDependencies } from "./dist/composition.js";

assert.equal(process.getuid(), 1000);
for (const path of [
  "/app",
  "/app/dist",
  "/app/dist/server.js",
  "/app/node_modules",
  "/app/web-dist",
]) {
  assert.throws(() => accessSync(path, constants.W_OK), { code: "EACCES" });
}
assert.ok(rootCertificates.length > 0);
assert.deepEqual(Intl.DateTimeFormat.supportedLocalesOf(["en", "zh-CN", "ja"]), [
  "en",
  "zh-CN",
  "ja",
]);
assert.equal(process.versions.bun, "1.4.2");
assert.ok(
  readFileSync("/usr/local/share/licenses/bun/LICENSE.md", "utf8").includes("MIT-licensed"),
);
assert.ok(createProductionDependencies().ttsService);

const voice = {
  id: "zh-CN-XiaoxiaoNeural",
  displayName: "Xiaoxiao",
  locale: "zh-CN",
  gender: "Female",
};
const synthesized = [];
const service = new TtsService({
  listVoices: async () => [voice],
  synthesize: async (request) => {
    synthesized.push(request);
    return {
      format: request.format,
      contentType: "audio/mpeg",
      audio: (async function* () {
        yield Buffer.from(request.text);
      })(),
    };
  },
});
const key = "container-contract-test-key";
const headers = { authorization: `Bearer ${key}` };
const app = createApp(
  { ttsService: service, serviceStats: service },
  {
    apiKey: key,
    requireApiKey: true,
    logger: false,
    serveStatic: true,
    metrics: true,
  },
);
try {
  for (const url of ["/health", "/api/health"]) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok" });
  }
  const index = await app.inject("/");
  assert.equal(index.statusCode, 200);
  const asset = index.body.match(/src="(\/assets\/[^"]+\.js)"/);
  assert.ok(asset, "WebUI entry bundle must exist");
  const script = await app.inject(asset[1]);
  assert.equal(script.statusCode, 200);
  assert.equal(script.headers["cache-control"], "public, max-age=31536000, immutable");

  assert.equal((await app.inject("/api/voices")).statusCode, 401);
  const voices = await app.inject({ url: "/api/voices", headers });
  assert.equal(voices.statusCode, 200);
  assert.deepEqual(voices.json().voices, [voice]);

  const input = "中😀a".repeat(220);
  for (const [url, payload] of [
    [
      "/api/speech",
      { input, voice: voice.id, quality: "high", speed: 1.25, pitchSemitones: 2, volume: 0.5 },
    ],
    ["/v1/audio/speech", { input, voice: voice.id, model: "tts-1-hd", speed: 1.25 }],
  ]) {
    const unauthorized = await app.inject({
      method: "POST",
      url,
      payload: "{",
      headers: { "content-type": "application/json" },
    });
    assert.equal(unauthorized.statusCode, 401);
    const response = await app.inject({ method: "POST", url, payload, headers });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "audio/mpeg");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.body, input);
    if (url === "/api/speech") assert.equal(response.headers["x-edgetts-segment-count"], "3");
  }
  assert.equal(synthesized.length, 6);
  assert.ok(
    synthesized.every((request) => request.format === "mp3-96k" && request.prosody.speed === 1.25),
  );
  assert.equal(synthesized[0].prosody.pitchSemitones, 2);
  assert.equal(synthesized[0].prosody.volume, 0.5);
  const metrics = await app.inject({ url: "/api/metrics", headers });
  assert.equal(metrics.statusCode, 200);
  assert.ok(metrics.body.includes("edgetts_synthesis_active 0"));
  assert.equal((await app.inject("/api/missing")).statusCode, 404);
  log(
    `PASS: ${process.arch} image permissions, ICU/TLS, WebUI, voices, both speech APIs and metrics`,
  );
} finally {
  await app.close();
}

// Exercise actual sockets: injection alone cannot prove streaming or disconnect semantics.
const { fetch, AbortController } = globalThis;
const deadline = setTimeout(() => {
  log("FAIL: HTTP streaming contract exceeded 60s");
  process.exit(1);
}, 60_000);
let streamState;
const streamingService = new TtsService(
  {
    listVoices: async () => [voice],
    synthesize: async (request, signal) => {
      const state = streamState;
      if (request.text === "blocked") state.signal = signal;
      return {
        format: "mp3-48k",
        contentType: "audio/mpeg",
        audio: (async function* () {
          yield Buffer.from([1, 2, 3]);
          if (request.text === "blocked") {
            await state.gate;
            state.advanced = true;
          }
          signal.throwIfAborted();
          yield Buffer.from([4, 5, 6]);
        })(),
      };
    },
  },
  { maxConcurrentSyntheses: 1, maxQueuedSyntheses: 1 },
);
const streamingApp = createApp(
  { ttsService: streamingService },
  { logger: false, serveStatic: false, requireApiKey: true, apiKey: key },
);
async function until(predicate) {
  for (let i = 0; i < 500 && !predicate(); i++) await delay(10);
  assert.ok(predicate(), "stream/queue state did not settle within 5s");
}
try {
  await streamingApp.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${streamingApp.server.address().port}`;
  for (const endpoint of ["/api/speech", "/v1/audio/speech"]) {
    const send = (input, signal) =>
      fetch(base + endpoint, {
        method: "POST",
        signal,
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          input,
          voice: voice.id,
          ...(endpoint.startsWith("/v1") ? { model: "tts-1" } : {}),
        }),
      });
    for (const cancel of [false, true]) {
      const gate = Promise.withResolvers();
      const state = { advanced: false, signal: null, gate: gate.promise, release: gate.resolve };
      streamState = state;
      const controller = new AbortController();
      const response = await send("blocked", controller.signal);
      assert.equal(response.status, 200);
      const reader = response.body.getReader();
      assert.deepEqual(Array.from((await reader.read()).value), [1, 2, 3]);
      assert.equal(state.advanced, false, "first bytes must arrive before the next chunk is ready");
      if (cancel) {
        const queued = send("queued").then(async (result) => {
          assert.equal(result.status, 200);
          return new Uint8Array(await result.arrayBuffer());
        });
        await until(() => streamingService.getStats().queuedSyntheses === 1);
        controller.abort();
        await reader.cancel().catch(() => {});
        await until(() => state.signal.aborted);
        assert.deepEqual(Array.from(await queued), [1, 2, 3, 4, 5, 6]);
        await until(() => streamingService.getStats().activeSyntheses === 0);
        state.release();
      } else {
        state.release();
        assert.deepEqual(Array.from((await reader.read()).value), [4, 5, 6]);
        assert.equal((await reader.read()).done, true);
        await until(() => streamingService.getStats().activeSyntheses === 0);
      }
      log(
        `PASS: ${process.arch} ${endpoint} ${cancel ? "cancellation and queue release" : "HTTP streaming"}`,
      );
    }
  }
} finally {
  streamState?.release();
  const closing = streamingApp.close();
  streamingApp.server.closeAllConnections();
  await closing;
  clearTimeout(deadline);
}
