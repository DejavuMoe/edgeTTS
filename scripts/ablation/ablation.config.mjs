import process from "node:process";
import { writeFileSync } from "node:fs";

export const groups = {
  service: { directory: "packages/tts-service", tests: ["test/*.test.ts"] },
  provider: { directory: "packages/edge-provider", tests: ["test/edge-provider.test.ts"] },
  http: { directory: "apps/server", tests: ["test/rate-limit.test.ts"] },
  playback: { directory: "apps/web", tests: ["test/stream-controller.test.ts"] },
};

// Each intervention changes one mechanism only, in Vite's in-memory source.
// Existing tests and assertions are never transformed. No production file is written.
export const variants = [
  ["no-cache-ttl", "service", "voice-cache.ts", "age < this.ttlMs", "age < 0"],
  ["no-single-flight", "service", "voice-cache.ts", "this.inFlight !== null", "false"],
  [
    "no-stale-fallback",
    "service",
    "voice-cache.ts",
    "this.cachedVoices !== null && !forceRefresh",
    "false",
  ],
  [
    "no-error-backoff",
    "service",
    "voice-cache.ts",
    "this.now() - this.lastErrorAt < this.errorBackoffMs",
    "this.now() - this.lastErrorAt < 0",
  ],
  ["no-cache-copy", "service", "voice-cache.ts", "voices.map((v) => ({ ...v }))", "voices"],
  [
    "no-active-limit",
    "service",
    "synthesis-limiter.ts",
    "this.activeCount < this.maxConcurrent",
    "true",
  ],
  [
    "no-queue-bound",
    "service",
    "synthesis-limiter.ts",
    "this.queue.length >= this.maxQueued",
    "false",
  ],
  [
    "no-natural-boundaries",
    "service",
    "text-segmenter.ts",
    "let splitCp = findLatestBoundary(paragraphEnds, pCursor, windowEndCp);",
    "let splitCp = windowEndCp;",
  ],
  [
    "no-unicode-index",
    "service",
    "text-segmenter.ts",
    "const cpLen = cp > 0xffff ? 2 : 1;",
    "const cpLen = 1;",
  ],
  [
    "no-session-permit",
    "service",
    "tts-service.ts",
    "segmentCount: segmentsToSynthesize.length,",
    "segmentCount: (permit.release(), segmentsToSynthesize.length),",
  ],
  [
    "no-whitespace-skip",
    "service",
    "tts-service.ts",
    "(segment) => segment.trim().length > 0",
    "() => true",
  ],
  [
    "no-late-setup-close",
    "provider",
    "edge-provider.ts",
    "if (setupAbandoned) client.close();",
    "void setupAbandoned;",
    2,
  ],
  [
    "no-cross-route-budget",
    "http",
    "rate-limit.ts",
    'global: () => "speech-global",',
    "global: (request) => request.routeOptions.url,",
  ],
  [
    "no-blob-fallback",
    "playback",
    "audio/stream-controller.ts",
    "await this.playBlobFallback(session, response, signal, callbacks);",
    'throw new Error("Blob fallback removed for ablation");',
    2,
  ],
  [
    "no-progress-throttle",
    "playback",
    "audio/stream-controller.ts",
    "totalBytes - lastReportedBytes >= PROGRESS_THROTTLE_BYTES",
    "totalBytes > lastReportedBytes",
  ],
].map(([id, group, file, from, to, occurrences = 1]) => ({
  id,
  group,
  file,
  from,
  to,
  occurrences,
}));

export default function () {
  const group = groups[process.env.EDGETTS_ABLATION_GROUP];
  if (!group) throw new Error("Run this config through scripts/ablation/ablation.mjs");
  const variant = variants.find((item) => item.id === process.env.EDGETTS_ABLATION_VARIANT);
  return {
    plugins: variant
      ? [
          {
            name: "edgetts-single-mechanism-ablation",
            enforce: "pre",
            transform(source, id) {
              if (!id.replaceAll("\\", "/").endsWith(`/${group.directory}/src/${variant.file}`))
                return;
              const count = source.split(variant.from).length - 1;
              if (count !== variant.occurrences)
                throw new Error(`Ablation anchor mismatch: ${variant.id}: ${count}`);
              writeFileSync(process.env.EDGETTS_ABLATION_MARKER, variant.id);
              return { code: source.replaceAll(variant.from, variant.to), map: null };
            },
          },
        ]
      : [],
    test: {
      reporters: [
        "json",
        {
          onTestRunEnd(_modules, errors, reason) {
            writeFileSync(
              process.env.EDGETTS_ABLATION_MARKER + ".runtime.json",
              JSON.stringify({
                reason,
                errors: errors.map((error) => ({ name: error.name, message: error.message })),
              }),
            );
          },
        },
      ],
      include: group.tests,
      environment: process.env.EDGETTS_ABLATION_GROUP === "playback" ? "jsdom" : "node",
    },
  };
}
