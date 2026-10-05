// Run through stdin in the final image, without network access or source-tree mounts:
// docker run --rm -i --network none edgetts:ci node --input-type=module < tests/docker-runtime.mjs
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { log } from "node:console";
import { accessSync, constants, readFileSync } from "node:fs";
import process from "node:process";
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
assert.ok(readFileSync("/usr/local/share/licenses/node/LICENSE", "utf8").includes("Node"));
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
