# Distroless migration evaluation

Candidate evaluated on 2026-11-17 under Docker Desktop / Debian WSL2, linux/amd64.
Starting source: ec75038dfa9360f69c1140ca4854782014c5f469.

The runtime changes from Alpine 3.24 plus Bun 1.4.4 musl to digest-pinned
gcr.io/distroless/cc-debian13:nonroot plus Bun 1.4.4 glibc. The builder remains
Alpine. UID/GID 1000 and the node account, root-owned application files, exec-form
startup and healthcheck, license notices and runtime environment remain intact.

## Measurement and decision

Both images were built locally from the same application source. The same
tests/runtime-footprint.mjs traverses each container filesystem and sums allocated
blocks, excluding proc, sys and dev. This measures filesystem allocation, not
compressed registry transfer size or Docker Desktop storage. Hard links may be
counted more than once; this is a conservative budget measurement.

- Alpine: 128,155,648 bytes (122.22 MiB).
- Distroless: 154,091,520 bytes (146.95 MiB).
- Increase: 25,935,872 bytes (24.73 MiB), approximately 20.2%.

The runtime budget is 160 MiB. The previous 128 MiB budget is exceeded; this
explicit tradeoff is accepted to standardize production on a shell-free runtime.
The older runtime-optimization.md measurements describe historical releases.

The benefit is removal of the shell and OS package manager, with explicit
regression checks for their absence. Distroless still contains Debian runtime
libraries and requires security updates. Bun itself remains a capable executable
with package-management and process/network APIs: absence of a shell does not
prevent arbitrary code execution or replace application security.

No throughput, startup, memory, CVE-count or compressed-download improvement has
been demonstrated. Do not use the size of static-distroless as a comparison:
Bun needs the glibc/C++ runtime supplied by cc-debian13.

Operational cost: docker exec sh, apk and shell-based command overrides no longer
work. Diagnose through logs, Bun commands or a separate debugging container.
Pinned image digests require deliberate updates.

## Verification

The amd64 candidate builds and passes tests/docker-runtime.mjs, covering
permissions, ICU/TLS, WebUI, voices, speech APIs, metrics, streaming and cancellation.
tests/provider-proxy.sh passes HTTP/HTTPS CONNECT, credentials, NO_PROXY, failure
and cancellation cases using a local CA. These are offline contracts, not live
Microsoft synthesis. The ARM64 image builds, but local execution fails with exec format error;
ARM64 runtime validation remains for a compatible runner. Signature verification was not performed.

Official image scope and shell limitations:
https://github.com/GoogleContainerTools/distroless
