import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { TtsServiceStats } from "@edgetts/tts-service";
import { createApp } from "../src/app.js";
import { createProductionDependencies } from "../src/composition.js";
import type { AppDependencies, TtsServicePort } from "../src/dependencies.js";
import {
  collectMetricFamilies,
  HttpResponseCounter,
  METRICS_CONTENT_TYPE,
  renderMetrics,
} from "../src/metrics.js";

const API_KEY = "metrics-test-api-key-1234567890";
const AUTH = { authorization: `Bearer ${API_KEY}` };

const service: TtsServicePort = {
  listVoices: () => Promise.resolve([]),
  synthesize: () => Promise.reject(new Error("unexpected synthesize")),
  synthesizeSegmented: () =>
    Promise.resolve({
      format: "mp3-48k",
      contentType: "audio/mpeg",
      segmentCount: 1,
      audio: (async function* () {
        yield new Uint8Array([1]);
      })(),
    }),
};

const STATS: TtsServiceStats = {
  activeSyntheses: 2,
  queuedSyntheses: 1,
  rejectedSyntheses: { queueFull: 3, queueTimeout: 4, unknownVoice: 5 },
  voiceCatalog: { voices: 321, ageMs: 1_500 },
};

describe("/api/metrics", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  function start(dependencies: AppDependencies, metrics: boolean): FastifyInstance {
    app = createApp(dependencies, { apiKey: API_KEY, metrics });
    return app;
  }

  it("is not served unless enabled", async () => {
    const target = start({ ttsService: service }, false);
    const response = await target.inject({ method: "GET", url: "/api/metrics", headers: AUTH });
    expect(response.statusCode).toBe(404);
  });

  it("requires the API key", async () => {
    const target = start({ ttsService: service }, true);
    const response = await target.inject({ method: "GET", url: "/api/metrics" });
    expect(response.statusCode).toBe(401);
  });

  it("exposes HTTP responses by route template and service counters", async () => {
    const target = start({ ttsService: service, serviceStats: { getStats: () => STATS } }, true);
    await target.inject({
      method: "POST",
      url: "/api/speech",
      headers: AUTH,
      payload: { voice: "zh-CN-XiaoxiaoNeural", input: "hi" },
    });
    await target.inject({ method: "POST", url: "/api/speech", headers: AUTH, payload: {} });
    await target.inject({ method: "GET", url: "/health?probe=secret-value" });
    await target.inject({ method: "GET", url: "/no/such/route" });

    const response = await target.inject({ method: "GET", url: "/api/metrics", headers: AUTH });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe(METRICS_CONTENT_TYPE);
    expect(response.headers["cache-control"]).toBe("no-store");
    const lines = response.body.split("\n");
    expect(lines).toEqual(
      expect.arrayContaining([
        "# TYPE edgetts_http_responses_total counter",
        'edgetts_http_responses_total{method="POST",route="/api/speech",status="200"} 1',
        'edgetts_http_responses_total{method="POST",route="/api/speech",status="400"} 1',
        'edgetts_http_responses_total{method="GET",route="/health",status="200"} 1',
        'edgetts_http_responses_total{method="GET",route="unmatched",status="404"} 1',
        "edgetts_synthesis_active 2",
        "edgetts_synthesis_queued 1",
        'edgetts_synthesis_rejected_total{reason="queue_full"} 3',
        'edgetts_synthesis_rejected_total{reason="queue_timeout"} 4',
        'edgetts_synthesis_rejected_total{reason="unknown_voice"} 5',
        "edgetts_voice_catalog_voices 321",
        "edgetts_voice_catalog_age_seconds 1.5",
      ]),
    );
    expect(lines.some((line) => /^process_resident_memory_bytes \d+$/.test(line))).toBe(true);
    // Labels carry route templates only: no query strings or unmatched paths.
    expect(response.body).not.toContain("secret-value");
    expect(response.body).not.toContain("/no/such/route");
  });

  it("wires the production service counters", async () => {
    const target = start(createProductionDependencies(), true);
    const response = await target.inject({ method: "GET", url: "/api/metrics", headers: AUTH });

    expect(response.body).toContain("\nedgetts_synthesis_active 0\n");
    expect(response.body).toContain("\nedgetts_voice_catalog_voices 0\n");
    // No catalog has been fetched, so its age is absent rather than a fake value.
    expect(response.body).not.toContain("edgetts_voice_catalog_age_seconds");
  });
});

describe("renderMetrics", () => {
  it("escapes label values", () => {
    const counter = new HttpResponseCounter();
    counter.record("GET", 'a\\b"c\nd', 200);
    const [httpFamily] = collectMetricFamilies(counter, undefined);

    expect(renderMetrics([httpFamily!])).toContain(
      'edgetts_http_responses_total{method="GET",route="a\\\\b\\"c\\nd",status="200"} 1',
    );
  });

  it("omits service families without a stats source", () => {
    const names = collectMetricFamilies(new HttpResponseCounter(), undefined).map((f) => f.name);
    expect(names).toEqual([
      "edgetts_http_responses_total",
      "process_resident_memory_bytes",
      "process_start_time_seconds",
    ]);
  });
});
