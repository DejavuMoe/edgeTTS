# Changelog

All notable changes to edgeTTS are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). `scripts/release-check.sh` requires a section for
the version being released.

## [Unreleased]

### Changed

- The web workbench follows the order the work happens. The synthesize action ends the text, next
  to the character count, and the result appears directly below it as a track: play button, voice,
  settings and size, a full-width timeline and download. The full voice name and ID are in its
  tooltip. The voice and delivery inspector runs the full height. On phones the page reads top to
  bottom (text, synthesize, result, settings) with nothing pinned over the content.

### Fixed

- Web workbench visual polish:
  - Quality option labels are vertically centred.
  - Speed, pitch and volume show their label and value above a full-width track, with a compact
    reset icon.
  - The editor focus line and coloured side stripes are gone, and hover and focus states now match
    across all controls.
  - On phones the voice list no longer paints over the pinned synthesize bar.
  - The transport bar keeps one height across states.
  - The voice list centres the restored voice and no longer repeats the region code on every row.
- Clearing the text is confirmed with a danger-styled button.

## [0.8.0] - 2026-09-25

### Changed

- Redesigned web workbench: a full-height text sheet, an inspector with an always-visible
  keyboard-navigable voice list (short names, locale groups, favorites pinned) and compact
  delivery controls, and a transport bar pinned to the bottom that keeps the synthesize action,
  progress, player and download in view. New warm neutral palette with a single accent, proper
  dark mode, and WCAG AA contrast for all text tokens, enforced by tests.
- The deployment guide now walks through Docker Compose with the pre-built image in all three
  languages; building from source with Compose is described as the development workflow.
- Repository layout: guides moved to `docs/en/`, `docs/zh-CN/` and `docs/ja/`; maintainer notes to
  `docs/development/`; repository tests to `tests/`; production Compose and systemd templates to
  `deploy/`, where `pnpm test` keeps the embedded copies in the guides identical.
- The README Quick Start Compose file now matches the deployment guide and template (configurable
  host binding, `REQUIRE_API_KEY` fail-closed default).

## [0.7.0] - 2026-09-25

### Added

- `400 UNKNOWN_VOICE` for voices missing from a fresh cached voice catalog. The check never
  fetches the catalog; a cold or expired cache lets the request through unchanged.
- `SPEECH_RATE_LIMIT_SCOPE=ip` for a separate speech budget per client address.
- `TRUST_PROXY` for reverse proxies whose forwarded client address is trusted.
- Capacity and timeout tuning: `SYNTHESIS_MAX_CONCURRENT`, `SYNTHESIS_MAX_QUEUED`,
  `VOICE_CACHE_TTL_MS`, `EDGE_VOICES_TIMEOUT_MS`, `EDGE_SETUP_TIMEOUT_MS` and
  `EDGE_AUDIO_IDLE_TIMEOUT_MS`.
- Optional Prometheus metrics at `/api/metrics` behind the API key (`METRICS_ENABLED=true`).
- A generated OpenAPI description, [docs/openapi.json](docs/openapi.json).
- A live long-text benchmark (`pnpm --filter @edgetts/tts-service bench`) and its results in
  [docs/development/research/performance.zh-CN.md](docs/development/research/performance.zh-CN.md).
- [Architecture and design decisions](docs/development/architecture.md).

### Changed

- Long-text requests reuse one upstream connection for all segments. In the benchmark,
  median delivery time for an 8-segment text fell by about half.
- Startup validates every environment variable at once and lists all problems. `PORT` and
  `HOST` are now validated, and an unrecognized `SERVE_STATIC` value aborts startup instead of
  being ignored.
- Request bodies are limited to 256 KiB (previously Fastify's 1 MiB default). Every valid
  request still fits.
- Invalid-request warnings log only issue codes and field paths, never rejected values.

### Internal

- Architecture boundaries are enforced by lint and verified by `pnpm test:architecture`.
- Type-aware linting and React hooks rules cover source and tests; web tests are type-checked.
- `pnpm test` checks multilingual documentation for consistency and `docs/openapi.json` for
  freshness.
- CI fails on high or critical advisories in production dependencies (`pnpm audit:deps`).
- The web workbench is split into focused hooks and panels around a tested synthesis reducer.

## [0.6.0] - 2026-09-22

### Added

- Reproducible architecture ablation experiments and their results.

### Fixed

- Late Edge TTS frames after a cancelled synthesis no longer crash the process.

## [0.5.0] - 2026-09-16

### Changed

- Hardened request lifecycles (cancellation and resource release) and simplified the
  deployment documentation.

## [0.4.0] - 2026-09-16

### Added

- Segmented long-text synthesis APIs and a four-language web interface.

## [0.3.0] - 2026-09-15

### Fixed

- Security and correctness findings from a repository-wide audit of the synthesis and release
  paths.

## [0.2.0] - 2026-09-15

### Changed

- Redesigned workbench controls; hardened synthesis security, resilience and abandoned-setup
  cleanup; improved multilingual installation guides.

## [0.1.0] - 2026-09-14

### Added

- First release: an OpenAI-compatible speech API, Edge voice discovery, prosody controls, the
  browser workbench and a container image.

[Unreleased]: https://github.com/DejavuMoe/edgeTTS/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/DejavuMoe/edgeTTS/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/DejavuMoe/edgeTTS/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/DejavuMoe/edgeTTS/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/DejavuMoe/edgeTTS/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/DejavuMoe/edgeTTS/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/DejavuMoe/edgeTTS/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/DejavuMoe/edgeTTS/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/DejavuMoe/edgeTTS/releases/tag/v0.1.0
