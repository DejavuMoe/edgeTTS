# Runtime tuning: indexed voice validation and image pruning

Measured on 2026-11-17, starting at `6b69d9a477a36d9184a8b02596723625c7f5469e`.
The runtime remains digest-pinned Bun 1.4.4 on Distroless Debian 13, without a shell.

## Changes and compatibility

VoiceCache builds a case-insensitive ID set once per successful catalog refresh.
Both synthesis entrypoints use this same cache-owned lookup, replacing a linear
scan that lowercased every visited ID on every request. Refresh atomically replaces
the snapshot and index. Failed refreshes preserve both; cold, empty and expired
catalogs still defer validation to the provider. Caller copies remain isolated.
This uses O(catalog size) retained memory to avoid O(catalog size) temporary
string allocations per request. It does not cache audio or change HTTP contracts.

The image drops TypeScript source files and dependency `.github` directories
after deploying compiled JavaScript. Runtime JavaScript, package metadata,
licenses, CA certificates, ICU and both module formats remain. Container footprint
checks reject these development artifacts; final-image contracts verify actual
imports, streaming, cancellation and proxy behavior after pruning.

## Measurements

Both images use the same locked dependencies, build toolchain and runtime.
Docker Desktop / Debian WSL2, linux/amd64, one CPU and 256 MiB container memory.
Each fresh container imports the application, calls ready(), validates health,
then exercises synthesis with a local provider returning a 128-byte audio chunk.
No upstream network is used. Each catalog has 320 or 1,000 synthetic voices; the
requested voice is last in the catalog, an intentionally expensive baseline case.
Early matches gain less. This is a service microbenchmark, not HTTP throughput or
real TTS latency.

Each workload warms 5,000 calls and measures 50 batches of 1,000 calls. P50/P95
are percentiles of batch means in microseconds per call. Three fresh containers
per variant run in interleaved before/after/smol order. Raw samples are in
[runtime-optimization-20261117.json](research/runtime-optimization-20261117.json).

| Metric                                |      Before |       After |
| ------------------------------------- | ----------: | ----------: |
| Root filesystem allocated bytes       | 154,091,520 | 151,068,672 |
| Application allocated bytes           |  15,134,720 |  12,111,872 |
| Exported filesystem, gzip -9 bytes    |  64,038,194 |  63,680,773 |
| 320 voices: median run P50, us/call   |       8.479 |       0.771 |
| 1,000 voices: median run P50, us/call |      26.264 |       0.751 |
| Peak process RSS, median KiB          |     102,420 |      78,588 |

Rootfs savings are 2.88 MiB (1.96%); the application portion shrinks 20.0%.
The compressed exported filesystem saves only 357,421 bytes (0.56%). This is not
an OCI registry transfer measurement: layer boundaries and compression differ.
Allocated block counting conservatively counts hard links more than once.
The official Bun executable alone is 107,308,936 bytes, limiting what application
pruning can save. The existing 160 MiB budget remains unchanged.

Across three runs, 320-voice P50 ranges are 8.432-8.878 us before and 0.762-0.776 us
after; 1,000-voice ranges are 25.640-26.463 and 0.749-0.845 us. Peak RSS ranges are
101,304-102,764 KiB before and 78,080-79,076 KiB after. Less transient string churn
is consistent with the lower synthetic-workload peak. This does not demonstrate a
production idle-memory reduction: idle RSS was approximately 64-66 MiB in both.
Ready() timing includes imports but excludes process/container creation, and these
short runs do not establish a startup improvement or long-running memory bound.

## Toolchain and dependency decisions

- Keep Node/pnpm/TypeScript for builds and Bun for the container. Changing the
  package manager cannot remove the runtime binary or the production dependency
  graph, and would replace the tested lockfile/deployment workflow without a
  demonstrated gain. Existing pnpm production deployment already excludes dev dependencies.
- Keep Fastify and its static/rate-limit plugins. Replacing them with a custom
  Bun HTTP layer would require reimplementing authentication order, body limits,
  static-path handling and stream cancellation; the measured hotspot was in our
  catalog lookup, which is now fixed without a framework migration.
- Keep ws/https-proxy-agent: they are covered by HTTP/HTTPS CONNECT, NO_PROXY and
  cancellation contracts. A native WebSocket replacement needs equivalent proxy
  behavior before any size or speed comparison is meaningful.
- Keep shared Zod schemas: browser response validation, server input validation
  and OpenAPI generation already share contracts. Zod Mini or another validator
  would require a separate compatibility/bundle experiment; removing validation
  to save bytes is not an optimization.
- Do not bundle the backend or compile a standalone executable in this phase.
  Bun supports these, but dynamic module loading, worker assets, licenses and
  SBOM package discovery need dedicated checks. Bun's runtime dominates size;
  a standalone executable does not automatically eliminate that cost.
- Keep the default GC policy. The optimized `--smol` variant peaked at a median
  75,928 KiB versus 78,588 KiB without it (about 2.60 MiB extra saving). Its CPU
  and timing ranges overlap. The official flag trades more frequent GC for
  memory; this small synthetic result does not justify changing every deployment.
  Memory-constrained operators can benchmark `bun --smol dist/server.js` with
  their own concurrency and text distribution before overriding the command.

Primary references: [Bun runtime and smol](https://bun.sh/docs/runtime),
[Bun bundler](https://bun.sh/docs/bundler),
[Fastify static plugin](https://github.com/fastify/fastify-static).

## Reproduction

Build the starting revision as `edgetts:optimization-before` and this revision as
`edgetts:optimization-after` using the repository Dockerfile. Keep Git and source
on Windows; run Docker and pnpm through linux-task.ps1 build mode.

```bash
docker run --rm -i --network none --memory=256m --cpus=1 \
  -e BENCH_VARIANT=after -e BENCH_RUN=1 \
  edgetts:optimization-after bun run - < apps/server/scripts/bench-container.mjs
# Repeat with the baseline image and with `bun --smol run -`, three times each.
docker run --rm -i --network none --user 0 \
  edgetts:optimization-after bun run - < tests/runtime-footprint.mjs
```

The benchmark asserts exact audio consumption and released permits, with no
timing threshold. Timing and process memory are observations, not CI assertions.
ARM64 execution, live Microsoft synthesis, production load and registry-published
artifact measurements are outside this experiment.
