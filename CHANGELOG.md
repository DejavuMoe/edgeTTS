# Changelog

All notable changes to edgeTTS are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). `scripts/release-check.sh` requires a section for
the version being released.

## [Unreleased]

## [1.0.0] - 2026-10-24

### Security

- Upgrade runtime validation to patched Zod 4 and use its native OpenAPI converter, preserving
  request constraints and redacted validation logs. Refresh Fastify, fast-uri and ip-address
  to compatible patched versions; production dependency auditing reports no known advisories.

### Changed

- Replace `msedge-tts` and its lifecycle patch with a native Edge protocol client using
  `fetch` and `ws`, preserving streaming, cancellation, timeouts and session reuse.
- Restore Microsoft synthesis after the v1 handshake was rejected with HTTP 403 by generating
  Sec-MS-GEC v2 tokens with the matching version prefix. Cover captured tokens, frame parsing,
  connection lifecycle and voice catalog validation with offline regressions.
- Use `master` as the primary branch for CI, release ancestry checks and local release preflight.
  Development images now follow `ghcr.io/dejavumoe/edgetts:master`; the former `:main` tag stops
  receiving updates. Existing stable release tags and images are unchanged.

### Compatibility

- Existing HTTP APIs, authentication, configuration, audio formats and text limits remain
  compatible. No configuration migration is required for the native provider.
- Validation logs use Zod 4 issue codes; invalid enum and literal values now share
  `invalid_value`. Request values remain redacted, and public HTTP error codes are unchanged.

## [0.9.6] - 2026-10-11

### Fixed

- Keep synthesis running when Escape dismisses the interface language menu. An unhandled
  Escape still cancels the active request.
- Block synthesis while a TXT import is pending, including keyboard shortcuts, so the request
  and editor cannot refer to different text. Preserve edits and clears that supersede a read.
- Clear an unavailable active voice when a refreshed catalog is empty, and allow the favorites
  filter to be turned off after its last matching voice disappears.
- Remove the UTF-8 import BOM exactly once, preserving a leading U+FEFF in the actual content
  and enforcing the 20,000-code-point limit against the preserved text.
- Preserve idle timeout failures between audio reads instead of reporting a successful end.
  Cancel abandoned WebSocket initialization and ignore delayed close events from replaced sockets.
- Map upstream failures on the first audio read to HTTP 502 for both speech APIs, before
  streaming headers are committed.
- Apply immutable caching only to assets inside the web root; a parent directory named
  `assets` no longer causes the HTML entry point to be cached for a year.
- Use the configured `PORT` in the container healthcheck, retaining 8080 as the default.
- Recheck the highest published stable version before writing a GitHub release, so a delayed
  older release cannot move GitHub's latest marker backward.
- Give Nginx proxy test runs unique container names and clean up only resources they created.
- Discard and close segmented audio that arrives after iterator return, and preserve cancellation
  errors in non-segmented streams while releasing concurrency permits exactly once.
- Share an in-flight voice catalog refresh without sharing callers' failure policies: ordinary
  reads may use the cached catalog, while forced refreshes still report upstream failures.
- Keep reading the complete audio response when the browser's MediaSource quota is exhausted.
  Preserve buffered preview playback, then switch to the full downloadable recording while
  retaining playback position and paused state.

### Compatibility

- Existing API shapes, authentication, configuration and text limits are unchanged. The fixes
  include regression coverage for all 16 confirmed audit findings and the MediaSource quota case.

## [0.9.5] - 2026-10-05

### Changed

- Switch the production container and healthcheck to Bun `1.4.2`, pinned by image digest.
  Keep Node.js and pnpm for source builds and bare-metal deployments. Preserve API contracts,
  environment variables, port 8080 and the existing non-root UID/GID 1000.
- Reduce the amd64 container root filesystem from about 160 MiB to 97 MiB with the Bun musl
  runtime and pruned dependency tests, examples and documentation. Preserve ICU, TLS, runtime
  and package licenses, the WebUI and both speech APIs; enforce a 105 MiB image budget in CI.
- Build the platform-independent JavaScript once on the builder's native CPU, reuse the build
  cache in CI, and compress published layers with gzip level 9. Both target architectures run
  an offline final-image contract check, including real HTTP streaming, disconnect cancellation
  and queue release, before publication completes. CI also verifies graceful SIGTERM shutdown.
- Avoid allocating Unicode offset tables when short text already fits in a single segment.

### Security

- Authenticate protected routes before reading or parsing request bodies. Missing or invalid
  credentials take precedence over malformed or oversized bodies; authenticated request
  validation and the public health/WebUI routes are unchanged.
- Make container application code and assets root-owned so the non-root service cannot replace
  them, and exclude nested environment and npm configuration files from the build context.
- Update Fastify to `5.12.5`, fast-uri to `3.1.8` / `4.2.1`, and ip-address to `10.7.3` within
  existing dependency ranges, resolving the six known production dependency audit findings.

## [0.9.4] - 2026-10-05

### Added

- STranslate integration instructions in the English, Chinese and Japanese guides, with links to
  the [edgeTTS plugin](https://github.com/DejavuMoe/STranslate.Plugin.Tts.edgeTTS) and its installation
  package. The guides cover API token authentication, automatic voice discovery, and native and
  OpenAI-compatible speech APIs.

### Changed

- Stable tag builds now create the GitHub release after the container image passes verification.
  Release notes include the changelog, upgrade instructions, and immutable multi-architecture
  image references.

### Security

- Update transitive `brace-expansion` dependencies from `5.0.9` to `5.0.12` and from `1.1.18` to
  `1.1.21`, addressing recursion denial-of-service advisories and restoring the production
  dependency audit without advisory exclusions.

## [0.9.2] - 2026-09-29

### Added

- Every voice has a portrait, drawn locally with DiceBear's Dylan style. The locale picks skin
  tones and hair colours common where the voice's language is spoken, and the gender picks the
  haircut; the voice ID seeds the choice, so each voice keeps its face. Portraits load in their own
  chunk after the first paint, with the monogram in their place until then.
- The web app has a favicon, Apple touch icon, web app manifest, description and Open Graph
  metadata, and the page title follows the interface language.

### Changed

- The logo is redrawn as lines of text, one of them breaking into a waveform.
- The container image is built on Alpine: the runtime stage is plain `alpine:3.24` with the Node
  binary and `libstdc++` only, without npm, npx, Yarn or Corepack, and source maps, type
  declarations and Markdown files are pruned from its dependencies. The unpacked image shrinks
  from about 280 MB to 168 MB, and the compressed download from 85 MB to 55 MB. The `node` user
  keeps UID/GID 1000.

### Fixed

- The finished take's waveform now draws when the web app is served by edgeTTS. The Content
  Security Policy blocked the browser from reading the take back from its local Blob URL, so the
  plain timeline was always shown; `connect-src` now allows `blob:` alongside the page's origin.

## [0.9.1] - 2026-09-26

### Fixed

- Non-segmented synthesis now closes late upstream audio and reports cancellation when the caller
  aborts as the provider returns, instead of yielding an empty successful stream.
- Voice discovery timeouts now cancel the underlying HTTP request, preventing abandoned requests
  from overlapping later retries.
- Takes above 12 MiB now skip the browser's extra Blob read before waveform decoding. The plain
  timeline and playback controls remain unchanged.

## [0.9.0] - 2026-09-26

### Added

- The finished take is drawn as its own waveform, decoded locally in the browser, with the played
  part in the accent colour and a time readout under the pointer. Seeking still uses the native
  slider, so keyboard, touch and screen readers work as before. Takes the browser cannot decode,
  or above 12 MiB, keep the plain timeline.
- While a take is synthesizing, a row of rising bars shows the voice forming until audio arrives.
- Every voice has a monogram in its own stable colour in the list and the current-voice card.
- A brand mark in the header.

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

[Unreleased]: https://github.com/DejavuMoe/edgeTTS/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/DejavuMoe/edgeTTS/compare/v0.9.6...v1.0.0
[0.9.6]: https://github.com/DejavuMoe/edgeTTS/compare/v0.9.5...v0.9.6
[0.9.5]: https://github.com/DejavuMoe/edgeTTS/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/DejavuMoe/edgeTTS/compare/v0.9.2...v0.9.4
[0.9.2]: https://github.com/DejavuMoe/edgeTTS/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/DejavuMoe/edgeTTS/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/DejavuMoe/edgeTTS/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/DejavuMoe/edgeTTS/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/DejavuMoe/edgeTTS/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/DejavuMoe/edgeTTS/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/DejavuMoe/edgeTTS/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/DejavuMoe/edgeTTS/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/DejavuMoe/edgeTTS/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/DejavuMoe/edgeTTS/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/DejavuMoe/edgeTTS/releases/tag/v0.1.0
