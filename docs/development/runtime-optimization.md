# Runtime and image optimization

Measured on Debian WSL2 with Node 24.21.0 on 2026-10-05. The baseline is the published
`v0.9.4` image and source at `44c34bf72fde770e44f3d49ed2451b0db78260f9`.

## Image footprint

Measurements use `linux/amd64`. Filesystem figures come from a fresh container with
`du -sxk /`, not Docker Desktop's image-store size, which can include compressed content,
unpacked snapshots and multiple architectures.

| Item                                  |          Baseline |         Optimized |
| ------------------------------------- | ----------------: | ----------------: |
| Root filesystem                       |       163,852 KiB |       138,772 KiB |
| Application and dependencies (`/app`) |        23,756 KiB |        15,332 KiB |
| Node executable                       | 131,391,152 bytes | 114,165,136 bytes |

The root filesystem is 15.3% smaller. The Dockerfile removes debug/linker metadata with
[`strip --strip-unneeded`](https://www.sourceware.org/binutils/docs/binutils/strip.html)
in a disposable target-platform stage, and removes dependency tests, examples and docs
before copying them into the runtime. Package licenses are retained; Node's license is
included separately. Native debugger symbol detail is reduced; JavaScript stack traces,
executable code, ICU and TLS remain available.

TypeScript and Vite run on
[`BUILDPLATFORM`](https://docs.docker.com/build/building/multi-platform/#cross-compilation),
so a multi-platform build shares the JavaScript build instead of compiling it again under
ARM emulation. Production dependencies currently contain no native addons; the build fails
if `.node` or `.so` files appear, requiring a target-platform deployment stage before those
dependencies can ship. The final image contract runs on both amd64 and arm64 in CI.

Published application layers use gzip level 9 and CI reuses BuildKit's GitHub Actions cache.
Runtime size and compressed download size are different metrics. CI bounds the amd64 root
filesystem at 145 MiB and continues to check the non-root UID, read-only deployment,
healthcheck, provenance and SBOM.

Node still occupies about 109 MiB. Further large reductions would require a different or
custom-built runtime, reducing ICU support, or executable packing. Those tradeoffs have not
been adopted: preserving runtime compatibility and predictable startup takes priority.

## Local CPU cost

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

## Security and compatibility checks

Protected routes authenticate in Fastify's `onRequest` hook, before parsing a body. The
regression test proves unauthorized requests never reach `preParsing`, while authenticated
malformed and oversized bodies still receive their existing errors. See the translated
[API guide](../en/api.md#authentication) for the error precedence.

Application files are root-owned while the service runs as UID 1000. The final-image check
proves they are not writable even without a read-only root, checks ICU and bundled TLS
certificates, and exercises the WebUI, voices, both speech APIs, Unicode segmentation and
metrics using a fake provider. It runs without network access:

```bash
docker build -t edgetts:ci .
docker run --rm -i --network none --cap-drop=ALL \
  --security-opt=no-new-privileges --memory=256m --cpus=1 --pids-limit=64 \
  edgetts:ci node --input-type=module < tests/docker-runtime.mjs
```

Fastify, fast-uri and ip-address were updated within their declared ranges. The production
dependency audit changed from six moderate findings to zero known findings at verification
time. This is a focused hardening and optimization pass, not a complete vulnerability audit.
