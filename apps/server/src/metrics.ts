import type { FastifyPluginAsync } from "fastify";
import type { TtsServiceStats } from "@edgetts/tts-service";

export const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

export interface TtsStatsSource {
  getStats(): TtsServiceStats;
}

const PROCESS_START_TIME_SECONDS = Math.round(Date.now() / 1000 - process.uptime());

type Labels = Readonly<Record<string, string>>;

interface Sample {
  readonly labels?: Labels;
  readonly value: number;
}

interface MetricFamily {
  readonly name: string;
  readonly type: "counter" | "gauge";
  readonly help: string;
  readonly samples: readonly Sample[];
}

/**
 * Counts completed HTTP responses by method, route template and status. Route templates
 * (never raw URLs) keep label cardinality bounded and free of user input.
 */
export class HttpResponseCounter {
  private readonly counts = new Map<string, { labels: Labels; value: number }>();

  record(method: string, route: string, status: number): void {
    const key = `${method} ${route} ${status}`;
    const entry = this.counts.get(key);
    if (entry) {
      entry.value++;
    } else {
      this.counts.set(key, { labels: { method, route, status: String(status) }, value: 1 });
    }
  }

  samples(): Sample[] {
    return [...this.counts.values()].map(({ labels, value }) => ({ labels, value }));
  }
}

export function collectMetricFamilies(
  http: HttpResponseCounter,
  stats: TtsServiceStats | undefined,
): MetricFamily[] {
  const families: MetricFamily[] = [
    {
      name: "edgetts_http_responses_total",
      type: "counter",
      help: "HTTP responses sent, by method, route template and status code.",
      samples: http.samples(),
    },
  ];

  if (stats) {
    const { rejectedSyntheses: rejected, voiceCatalog } = stats;
    families.push(
      {
        name: "edgetts_synthesis_active",
        type: "gauge",
        help: "Synthesis sessions currently holding a concurrency permit.",
        samples: [{ value: stats.activeSyntheses }],
      },
      {
        name: "edgetts_synthesis_queued",
        type: "gauge",
        help: "Synthesis requests waiting for a concurrency permit.",
        samples: [{ value: stats.queuedSyntheses }],
      },
      {
        name: "edgetts_synthesis_rejected_total",
        type: "counter",
        help: "Synthesis requests rejected before reaching the provider, by reason.",
        samples: [
          { labels: { reason: "queue_full" }, value: rejected.queueFull },
          { labels: { reason: "queue_timeout" }, value: rejected.queueTimeout },
          { labels: { reason: "unknown_voice" }, value: rejected.unknownVoice },
        ],
      },
      {
        name: "edgetts_voice_catalog_voices",
        type: "gauge",
        help: "Voices in the cached catalog; 0 before the first successful fetch.",
        samples: [{ value: voiceCatalog?.voices ?? 0 }],
      },
    );
    if (voiceCatalog) {
      families.push({
        name: "edgetts_voice_catalog_age_seconds",
        type: "gauge",
        help: "Time since the cached voice catalog was fetched.",
        samples: [{ value: voiceCatalog.ageMs / 1000 }],
      });
    }
  }

  families.push(
    {
      name: "process_resident_memory_bytes",
      type: "gauge",
      help: "Resident memory size in bytes.",
      samples: [{ value: process.memoryUsage.rss() }],
    },
    {
      name: "process_start_time_seconds",
      type: "gauge",
      help: "Start time of the process since the Unix epoch in seconds.",
      samples: [{ value: PROCESS_START_TIME_SECONDS }],
    },
  );
  return families;
}

/** Renders the Prometheus text exposition format (version 0.0.4). */
export function renderMetrics(families: readonly MetricFamily[]): string {
  const lines: string[] = [];
  for (const family of families) {
    lines.push(`# HELP ${family.name} ${family.help}`, `# TYPE ${family.name} ${family.type}`);
    for (const sample of family.samples) {
      lines.push(`${family.name}${formatLabels(sample.labels)} ${sample.value}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatLabels(labels: Labels | undefined): string {
  if (!labels) return "";
  const pairs = Object.entries(labels).map(([name, value]) => `${name}="${escapeLabel(value)}"`);
  return `{${pairs.join(",")}}`;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export function createMetricsRoutes(
  http: HttpResponseCounter,
  stats: TtsStatsSource | undefined,
): FastifyPluginAsync {
  return async (fastify) => {
    fastify.get("/metrics", async (_request, reply) =>
      reply
        .code(200)
        .header("Cache-Control", "no-store")
        .type(METRICS_CONTENT_TYPE)
        .send(renderMetrics(collectMetricFamilies(http, stats?.getStats()))),
    );
  };
}
