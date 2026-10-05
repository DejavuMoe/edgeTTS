# Releases and rollback

Container images are published to GHCR as `ghcr.io/dejavumoe/edgetts`. The [CI workflow](../../.github/workflows/ci.yml) is the source of truth for validation and publication.

## Publication contract

- Stable Git tags use `vX.Y.Z` with no leading zeros, prerelease suffixes or build metadata. The tagged commit must be reachable from `origin/main`; moved tags are rejected.
- Publication follows the quality, Docker image and deterministic proxy jobs. Both `main` pushes and stable tag pushes can publish candidates; pull requests do not publish.
- Candidates use `sha-<full-git-sha>`; `main` also receives a development image tag. Verification covers `linux/amd64`, `linux/arm64` (under QEMU), runtime permissions, provenance and SBOM attestations.
- Stable aliases are promoted from the verified OCI index digest without rebuilding. An existing version with another digest is rejected; an identical digest permits an idempotent rerun.
- `latest` follows the highest successfully published stable SemVer. Older maintenance releases and reruns do not move it backward. Registry publication is serialized.

## Create a release

Start from a clean, synchronized `main` with successful CI. Update package versions and release examples consistently, and move the `[Unreleased]` entries of [CHANGELOG.md](../../CHANGELOG.md) under a `## [X.Y.Z] - YYYY-MM-DD` section. `pnpm test` fails if any documented image tag no longer matches the package version. Then validate before creating the tag:

```bash
git fetch origin
git status --short --branch
./scripts/release-check.sh vX.Y.Z
git tag -a vX.Y.Z -m "edgeTTS X.Y.Z"
git push origin vX.Y.Z
```

The preflight script checks the version, repository state, tag availability, the package version and changelog section, and local validation. It does not create or push tags. On workstations with separate build runtimes, run the complete validation there and use `--skip-tests` for the Git preflight in the canonical checkout.

After the image is published, a final release job creates the [GitHub release](https://github.com/DejavuMoe/edgeTTS/releases) from the version's changelog section, with upgrade steps, the verification facts and the immutable image references rendered by `scripts/release-notes.sh`. It is the only job with `contents: write`. The release becomes GitHub's latest only when the tag also moved the `latest` image alias, and a rerun refreshes the existing release instead of failing.

After publishing:

1. Confirm all five CI jobs succeeded: quality, Docker image, proxy contract, publication and GitHub release.
2. Verify `X.Y.Z` resolves to the candidate digest. Verify `latest` only advances when this is the highest published stable version.
3. Review the generated release notes. To rebuild them by hand, pass the published values to the same script: `COMMIT_SHA=… RUN_URL=… INDEX_DIGEST=… AMD64_DIGEST=… ARM64_DIGEST=… LATEST_UPDATED=true ./scripts/release-notes.sh X.Y.Z`.

```bash
docker buildx imagetools inspect ghcr.io/dejavumoe/edgetts:X.Y.Z
docker buildx imagetools inspect ghcr.io/dejavumoe/edgetts:latest
```

## Maintain dependencies

CI runs `pnpm audit:deps` and fails on high or critical advisories in production dependencies. No external update service is configured, so review dependencies before releases:

```bash
pnpm audit --prod          # all advisory levels for runtime dependencies
pnpm outdated -r           # available updates across the workspace
pnpm update -r <package>   # update within declared ranges, then run the full validation suite
```

Major upgrades, the pinned Node.js and pnpm versions (`package.json`, `Dockerfile`, CI) and the pinned GitHub Actions commit SHAs are updated by hand in a dedicated commit. Keep `patches/msedge-tts@2.0.7.patch` in mind when upgrading msedge-tts: remove it only once upstream ignores frames for destroyed streams and supports abortable voice discovery.

The container runtime uses a separately pinned Bun image. When upgrading it, update the
`BUN_IMAGE` version and multi-architecture digest, the Bun license URL/checksum in `Dockerfile`,
the version assertion in `tests/docker-runtime.mjs`, and the translated deployment guides.
Run the final-image contract on both architectures before promoting release aliases.

## Roll back a deployment

Use the recorded digest of a previously verified image. Keep the existing API key and deployment settings. In `compose.yaml`, restore that image reference:

```yaml
services:
  edgetts:
    image: ghcr.io/dejavumoe/edgetts@sha256:<known-good-digest>
```

```bash
docker compose pull edgetts
docker compose up -d edgetts
curl --fail http://127.0.0.1:8080/health
```

The health endpoint confirms the HTTP process only; verify an authenticated synthesis separately. Rebuilding an old source revision does not reproduce the original image. Keep release tags immutable and avoid moving `latest` to implement a rollback. A single-instance replacement can interrupt active streams; see [deployment](../en/deployment.md).

## Repository protection

Repository administrators can require review and the quality, Docker and proxy checks for `main`, block force pushes and deletion, and restrict release-tag creation to maintainers. Do not require the publication job as a pull-request check. Protect stable tags against updates and deletion. These settings are administrative controls, not changes performed by CI.
