# Runtime and image optimization

Measured on Debian WSL2 with Node 24.21.0 and Bun 1.4.2 on 2026-10-05. The baseline is the published
`v0.9.4` image and source at `44c34bf72fde770e44f3d49ed2451b0db78260f9`.

## Image footprint

Measurements use `linux/amd64`. Filesystem figures come from a fresh container with
`docker run --rm --user 0 IMAGE du -sxk /`, not Docker Desktop's image-store size, which can include compressed content,
unpacked snapshots and multiple architectures.

| Item                                  |     v0.9.4 / Node | Pruned / stripped Node |     v0.9.5 / Bun |
| ------------------------------------- | ----------------: | ---------------------: | ---------------: |
| Root filesystem                       |       163,852 KiB |            138,772 KiB |       98,884 KiB |
| Application and dependencies (`/app`) |        23,756 KiB |             15,332 KiB |       15,332 KiB |
| Runtime executable                    | 131,391,152 bytes |      114,165,136 bytes | 73,475,696 bytes |

The shipped root filesystem is 96.57 MiB, 39.7% smaller than v0.9.4 and 28.7% smaller than
the intermediate Node optimization. The Dockerfile copies the official Bun 1.4.2 musl binary
from a digest-pinned multi-architecture image into Alpine 3.24. Dependency tests, examples,
documentation, type declarations and source maps are pruned. Package licenses and Bun's
license/third-party notices remain in the image, as do ICU, TLS and the WebUI.

Node and pnpm remain the build toolchain and the documented bare-metal runtime. The container
uses Bun for both the server and its healthcheck, with transpiler disk caching disabled for
read-only deployments. The existing UID/GID 1000, account name, environment variables and
HTTP contracts are preserved.

TypeScript and Vite run on
[`BUILDPLATFORM`](https://docs.docker.com/build/building/multi-platform/#cross-compilation),
so a multi-platform build shares the JavaScript build instead of compiling it again under
ARM emulation. Production dependencies currently contain no native addons; the build fails
if `.node` or `.so` files appear, requiring a target-platform deployment stage before those
dependencies can ship. The final image contract runs on both amd64 and arm64 in CI.

Published application layers use gzip level 9 and CI reuses BuildKit's GitHub Actions cache.
Runtime size and compressed download size are different metrics. CI bounds the amd64 root
filesystem at 105 MiB and continues to check the non-root UID, read-only deployment,
healthcheck, provenance and SBOM.

Bun occupies about 70 MiB. The image uses the official runtime binary without custom builds,
executable packing or reduced locale support.

## Local CPU cost

The following CPU measurements use Node 24.21.0 for both revisions; they measure the text
segmentation change independently of the container runtime switch.

The short-text path checks UTF-16 length before building Unicode offset tables. UTF-16
length is an upper bound on code-point count, so this fast path cannot admit an oversized
segment. Larger input still uses the existing Unicode and natural-boundary algorithm.

Run the CPU-only benchmark without contacting Microsoft:

```bash
pnpm --filter @edgetts/tts-service exec tsx scripts/bench-local.ts
```

The script warms each workload, then reports P50/P95/P99 of 100 batch means in microseconds
per call. These are microbenchmark batch statistics, not HTTP request latency percentiles.

| Workload                  | Baseline P50 | Optimized P50 |
| ------------------------- | -----------: | ------------: |
| Short mixed-language text |     1.527 us |      0.017 us |
| 300 BMP characters        |     2.809 us |      0.016 us |
| 300 emoji                 |     4.084 us |      2.935 us |
| Long mixed-language text  |   463.793 us |    397.651 us |

Only the first two workloads take the new fast path. Changes in the other two are run-to-run
noise and JIT effects, not evidence of a faster long-text algorithm. This optimization avoids
local allocations; it does not establish a reduction in upstream synthesis time.

A separate local HTTP probe used an independent Node client, eight concurrent requests,
one server CPU and 256 MiB of memory. With a fake provider returning two 2 KiB chunks 5 ms
apart, Node measured 1,305–1,334 requests/s and Bun 1,190–1,355 requests/s across runs.
These overlapping ranges do not establish a throughput advantage for Bun. The verified
benefit is image size; actual synthesis latency still depends on Microsoft's upstream.

## Security and compatibility checks

Protected routes authenticate in Fastify's `onRequest` hook, before parsing a body. The
regression test proves unauthorized requests never reach `preParsing`, while authenticated
malformed and oversized bodies still receive their existing errors. See the translated
[API guide](../en/api.md#authentication) for the error precedence.

Application files are root-owned while the service runs as UID 1000. The final-image check
proves they are not writable even without a read-only root, checks ICU and bundled TLS
certificates, and exercises the WebUI, voices, both speech APIs, Unicode segmentation and
metrics using a fake provider. Real loopback HTTP requests additionally prove that the first
chunk arrives before synthesis completes and that disconnecting aborts the provider and
releases a queued request for both speech APIs. CI runs this contract on amd64 and arm64 and
checks missing-key startup rejection, the real container healthcheck and graceful SIGTERM
shutdown. The contract needs no external network access:

```bash
docker build -t edgetts:ci .
docker run --rm -i --network none --cap-drop=ALL \
  --security-opt=no-new-privileges --memory=256m --cpus=1 --pids-limit=64 \
  edgetts:ci bun run - < tests/docker-runtime.mjs
```

The local Bun image also passed 184 request-boundary probes covering authentication, Unicode
limits, parameter ranges, error mapping and rate limits. A separate live probe retrieved 322
Microsoft voices and received MP3 streams from both speech endpoints (13,968 bytes for native
standard quality and 27,936 bytes for the compatible high-quality request). These are observed
smoke-test results, not a guarantee of future upstream availability.

Fastify, fast-uri and ip-address were updated within their declared ranges. The production
dependency audit changed from six moderate findings to zero known findings at verification
time. This is a focused hardening and optimization pass, not a complete vulnerability audit.
