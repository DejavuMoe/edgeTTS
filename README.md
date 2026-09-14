# EdgeTTS

Self-hosted Microsoft Edge TTS Web application and streaming speech synthesis API.

## Architecture

- `apps/server`: Fastify HTTP API and static application server (`@edgetts/server`), providing `GET /health`, `GET /api/health`, `GET /api/voices`, `POST /v1/audio/speech`, and `POST /api/speech`, with production same-origin SPA hosting for `@edgetts/web`.
- `apps/web`: React + Vite frontend application (`@edgetts/web`), providing an interactive TTS workbench with real-time Unicode code-point counting, voice discovery/filtering, prosody controls, and dual-mode playback (MediaSource progressive streaming with seamless Blob fallback).
- `packages/shared`: Shared TypeScript types, Zod schemas, and Unicode utilities (`@edgetts/shared`).
- `packages/tts-core`: Provider-neutral TTS domain contracts (`@edgetts/tts-core`), defining synthesis controls: `speed` (0.5–2.0), `pitchSemitones` (-12–12), and `volume` (0–1).
- `packages/edge-provider`: Microsoft Edge Read Aloud adapter (`@edgetts/edge-provider`), mapping domain prosody controls to `msedge-tts`.
- `packages/tts-service`: Provider-independent application service (`@edgetts/tts-service`), providing cached voice discovery, configurable in-memory voice TTL, concurrent voice-fetch de-duplication, bounded FIFO synthesis concurrency limiting (4 active, 16 queued), lossless text segmentation, and segmented sequential synthesis orchestration.

## Features

- **Dual Speech API**:
  - OpenAI-compatible `POST /v1/audio/speech` (1–4096 characters, `tts-1` / `tts-1-hd`).
  - Native segmented `POST /api/speech` (up to 20,000 Unicode code points, standard/high quality, fine-grained prosody).
- **Lossless Text Segmentation**:
  - Boundary hierarchy: paragraph > line > sentence > whitespace > hard cut.
  - Unicode code-point accurate limits preserving surrogate pairs and CRLF atomicity.
  - Rejoining chunks exactly reproduces original input without mutation or trimming.
- **Fair Concurrency Control**:
  - Bounded FIFO limiter (4 active streams, 16 queue slots).
  - Segmented synthesis acquires/releases limiter permits per-segment, preventing single long requests from monopolizing execution capacity.
  - Client disconnect cancels queued requests and active streams immediately.
- **Progressive Browser Streaming**:
  - Workbench player leverages `MediaSource` and `SourceBuffer` for near-instant playback start.
  - Transparent fallback to Blob object URLs when `MediaSource` is unsupported.
  - Simultaneous stream chunk accumulation enables instant audio download upon completion.
- **Production Single-Origin Web Hosting**:
  - Fastify hosts built frontend assets (`apps/web/dist`) and API endpoints under a single port/domain.
  - Immutable long-term caching for hashed assets (`/assets/*`).
  - Revalidation caching (`no-cache`) for `index.html`.
  - Non-interfering SPA fallback routing preserving API 404 responses for `/api/*` and `/v1/*`.
  - Graceful degradation to API-only mode when static assets are not present.

## API Endpoints

### `GET /health` and `GET /api/health`

Health check endpoint returning `{ "status": "ok" }`.

### `GET /api/voices`

Returns cached Edge TTS voices in `{ "voices": [...] }`.

### `POST /v1/audio/speech`

OpenAI-compatible speech endpoint subset with MP3 streaming.

**Supported options:**

- `model`: `tts-1` (mapped to `mp3-48k`) or `tts-1-hd` (mapped to `mp3-96k`)
- `voice`: Edge TTS voice ID (e.g. `zh-CN-XiaoxiaoNeural`, `en-US-JennyNeural`)
- `input`: Plain text (1–4096 characters, non-empty)
- `response_format`: `mp3` (optional, default: `mp3`)
- `speed`: `0.5`–`2.0` (optional, default: `1.0`)

**Example usage:**

```bash
curl \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "tts-1",
    "voice": "zh-CN-XiaoxiaoNeural",
    "input": "你好，世界。",
    "response_format": "mp3",
    "speed": 1
  }' \
  http://127.0.0.1:8080/v1/audio/speech \
  --output speech.mp3
```

### `POST /api/speech`

Native segmented long-text speech API returning streaming MP3 audio.

**Supported options:**

- `input`: Plain text (1–20,000 Unicode code points)
- `voice`: Edge TTS voice ID
- `quality`: `"standard"` (`mp3-48k`, default) or `"high"` (`mp3-96k`)
- `speed`: `0.5`–`2.0` (optional, default: `1.0`)
- `pitchSemitones`: `-12.0`–`12.0` (optional, default: `0.0`)
- `volume`: `0.0`–`1.0` (optional, default: `1.0`)

**Example usage:**

```bash
curl \
  -H 'Content-Type: application/json' \
  -d '{
    "input": "这是一段较长的文本，系统会在服务端进行无损分段并在单连接中无缝流式返回合成音频。",
    "voice": "zh-CN-XiaoxiaoNeural",
    "quality": "standard",
    "speed": 1.0,
    "pitchSemitones": 0.0,
    "volume": 1.0
  }' \
  http://127.0.0.1:8080/api/speech \
  --output long-speech.mp3
```

## Requirements

- Node.js (v24 LTS recommended)
- pnpm (v10+ or v12+)

## Install

```bash
pnpm install
```

## Development

Start both the Fastify server and Vite dev server concurrently with HMR:

```bash
pnpm dev
```

- Server API: `http://127.0.0.1:8080`
- Web Workbench: Vite local dev server (default: `http://localhost:5173`, proxies `/api` to port 8080)

## Production Build & Single-Origin Deployment

### 1. Build Monorepo

Compile all packages and build the frontend application into `apps/web/dist`:

```bash
pnpm build
```

### 2. Start Production Server

Run the production server with static hosting enabled:

```bash
NODE_ENV=production node apps/server/dist/server.js
```

Or via pnpm:

```bash
NODE_ENV=production pnpm --filter @edgetts/server start
```

### Environment Configuration

| Variable                      | Description                                                                                         | Default                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `HOST`                        | Bind address for Fastify server                                                                     | `127.0.0.1`                                                   |
| `PORT`                        | Listening port for Fastify server                                                                   | `8080`                                                        |
| `NODE_ENV`                    | Environment mode (`production`, `development`, `test`)                                              | Unset by default; static hosting auto-enabled in `production` |
| `SERVE_STATIC`                | Explicit toggle for static web hosting (`true` / `false`)                                           | Unset (explicit override; auto-enabled in `production`)       |
| `WEB_DIST_DIR`                | Absolute or relative path to web static assets directory                                            | `../../web/dist` relative to server                           |
| `API_KEY`                     | Optional Bearer secret protecting synthesis & voices APIs (>= 16 characters, no whitespace)         | Unset (authentication disabled unless `REQUIRE_API_KEY=true`) |
| `REQUIRE_API_KEY`             | Fail-closed authentication gate (`true` / `false`). Refuses startup if `API_KEY` is missing/invalid | `false` in bare Node, `true` in Docker Compose                |
| `SPEECH_RATE_LIMIT_MAX`       | Max admitted speech synthesis requests per process rate limit window (1–10000)                      | `12`                                                          |
| `SPEECH_RATE_LIMIT_WINDOW_MS` | Speech synthesis rate limit window duration in milliseconds (100–3600000)                           | `10000` (10 seconds)                                          |

## Authentication

EdgeTTS provides an optional, stateless Bearer API key authentication layer:

- **When `API_KEY` is unset**: Authentication is completely disabled (unless `REQUIRE_API_KEY=true`). All endpoints retain open unauthenticated behavior.
- **When `API_KEY` is configured**: Protected synthesis and voice discovery APIs require a valid Bearer token in the `Authorization` header (`Authorization: Bearer <API_KEY>`).

### Endpoint Access Policy

- **Public Endpoints** (never require authentication):
  - `GET /health` (Container / orchestrator uptime probe)
  - `GET /api/health`
  - Static WebUI (`/`, `/assets/*`, and client SPA routes)
- **Protected Endpoints** (require Bearer key when authentication is enabled):
  - `GET /api/voices`
  - `POST /api/speech`
  - `POST /v1/audio/speech`

### Fail-Closed Enforcement (`REQUIRE_API_KEY`)

To prevent accidental open exposure in containerized or automated deployments, EdgeTTS supports a fail-closed authentication mode controlled by `REQUIRE_API_KEY`:

- **Bare Node Default**: Defaults to `REQUIRE_API_KEY=false` for development simplicity.
- **Docker Compose Default**: Defaults to `${REQUIRE_API_KEY:-true}` (`true`). If `API_KEY` is missing, empty, or less than 16 characters, the container fails fast and exits immediately during startup before binding the network listener.
- **Explicit Unauthenticated Opt-Out**: If deploying in an intentionally open environment or behind an external auth proxy (such as Authelia or Cloudflare Access), set `REQUIRE_API_KEY=false` in `.env`.

### Security Guidance

- Use a high-entropy random secret containing at least 16 characters with no whitespace.
- Generate a secure random secret using OpenSSL:
  ```bash
  openssl rand -hex 32
  ```
- **Never** expose `API_KEY` in client-side build variables, frontend bundles, or commit secrets to version control.
- Credentials are verified via constant-time SHA-256 comparison (`timingSafeEqual`) and are never written to server logs.

### Running with Authentication

Start the production server with the `API_KEY` environment variable:

```bash
API_KEY='<your-secret>' \
NODE_ENV=production \
node apps/server/dist/server.js
```

### Calling Protected Endpoints

#### OpenAI-Compatible Endpoint:

```bash
curl \
  -H 'Authorization: Bearer <your-secret>' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "tts-1",
    "voice": "zh-CN-XiaoxiaoNeural",
    "input": "你好，世界。"
  }' \
  http://127.0.0.1:8080/v1/audio/speech \
  --output speech.mp3
```

#### Native Speech Endpoint:

```bash
curl \
  -H 'Authorization: Bearer <your-secret>' \
  -H 'Content-Type: application/json' \
  -d '{
    "input": "示例文本内容",
    "voice": "zh-CN-XiaoxiaoNeural"
  }' \
  http://127.0.0.1:8080/api/speech \
  --output speech.mp3
```

### WebUI In-Memory Key Policy

The built-in Web Workbench does not persist API keys in `localStorage`, `sessionStorage`, `IndexedDB`, cookies, or URL query/hash parameters. When application authentication is enabled, the key is kept only in current browser memory and must be re-entered after a page reload.

## Abuse Controls & Rate Limiting

EdgeTTS enforces layered protection against abuse and upstream saturation:

1. **Admission Rate Limiter (Fastify Layer)**:
   - Evaluated before speech synthesis starts.
   - Enforces an in-memory global admission quota (`SPEECH_RATE_LIMIT_MAX` requests per `SPEECH_RATE_LIMIT_WINDOW_MS`, default 12 requests per 10 seconds).
   - Shared between `POST /api/speech` and `POST /v1/audio/speech`.
   - Independent of client IP address (`trustProxy: false` by design to prevent header spoofing); protects the server process globally.
   - If authentication is enabled, authentication verification executes **before** rate limiting: unauthenticated requests (HTTP 401) do not consume quota.
   - When exceeded, requests are immediately rejected with HTTP `429 Too Many Requests`, a `Retry-After: <seconds>` header, and structured JSON:
     ```json
     {
       "error": {
         "code": "RATE_LIMITED",
         "message": "Too many speech requests"
       }
     }
     ```
   - Rate-limited requests are dropped before invoking `TtsService`, preventing upstream load.
   - Health probes (`GET /health`, `GET /api/health`), voice discovery (`GET /api/voices`), and static assets are exempt from rate limiting.

2. **Synthesis Concurrency Limiter (`TtsService` Layer)**:
   - Admitted requests proceed to the domain concurrency limiter (max 4 concurrent active syntheses, max 16 queued requests).
   - If queue capacity is exceeded, requests receive `503 Service Unavailable` (`SERVER_BUSY`).

## Container Images

edgeTTS publishes official multi-architecture production container images to GitHub Container Registry (GHCR):

```text
ghcr.io/dejavumoe/edgetts
```

### Supported Architectures

- `linux/amd64` (x86_64)
- `linux/arm64` (aarch64)

### Reference & Tagging Conventions

In container registries, image tags are mutable pointers that can technically be reassigned by actors with write access. An OCI digest (`@sha256:...`) is the only intrinsically immutable, content-addressed reference.

| Reference Format      | Example                                            | Semantic Meaning & Mutability                                                                                                                                                                                              |
| --------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@sha256:<digest>`    | `ghcr.io/dejavumoe/edgetts@sha256:<64-hex-digest>` | **Intrinsically immutable content-addressed reference** (recommended for production). Computed directly from the OCI manifest index bytes; impossible to overwrite, retag, or mutate.                                      |
| `:sha-<full-git-sha>` | `ghcr.io/dejavumoe/edgetts:sha-<full-40-hex-sha>`  | **Commit-addressable traceability tag** generated from the full 40-character Git commit SHA. The project publishing workflow treats this as a stable traceability reference, but OCI tags are not intrinsically immutable. |
| `:main`               | `ghcr.io/dejavumoe/edgetts:main`                   | **Moving branch alias** pointing to the latest validated build published from the `main` branch.                                                                                                                           |
| `:X.Y.Z`              | `ghcr.io/dejavumoe/edgetts:0.1.0`                  | **Release tag** created on git tags matching `v*.*.*` by project publishing policy; remains a registry tag reference.                                                                                                      |
| `:latest`             | `ghcr.io/dejavumoe/edgetts:latest`                 | **Moving stable-release alias** pointing to the most recent SemVer release (never updated by `main` branch pushes).                                                                                                        |

### Digest-First Production Deployment & Rollback Contract

In production environments, always prefer deploying by exact image digest (`@sha256:<digest>`) rather than mutable tags (`:main`, `:latest`, or `:sha-<full-git-sha>`):

1. **True Content-Addressed Immutability**: Container tags in any registry are mutable references that can be retagged. An OCI digest is a cryptographic hash of the OCI manifest index itself, guaranteeing permanent immutability.
2. **Deterministic Rollouts & Rollbacks**: Every node in a cluster pulls the exact same container layers, preventing configuration drift across instances.
3. **Immutable Rollback Procedure**: _Rollback means redeploying a previously verified OCI digest. It does not mean rebuilding an old Git commit._ Never roll back by `:latest` (a moving pointer) or force-push old Git release tags. See [`docs/releasing.md`](docs/releasing.md) for the complete production rollback procedure.
4. **Supply Chain Integrity**: edgeTTS builds publish BuildKit SLSA provenance (`mode=max`) and SPDX SBOM attestations attached directly to every image index.
5. **Distinction Between Git SHA and OCI Digest**: The Git commit SHA identifies a specific source tree state in version control, whereas the OCI manifest digest cryptographically identifies the exact compiled multi-architecture container artifacts in the registry.

**Example `docker run` by digest:**

```bash
docker run -d \
  --name edgetts \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --tmpfs /tmp \
  -e API_KEY='replace-with-a-random-secret' \
  -p 127.0.0.1:8080:8080 \
  ghcr.io/dejavumoe/edgetts@sha256:<digest>
```

**Example `docker-compose.yml` image override:**

```yaml
services:
  edgetts:
    image: ghcr.io/dejavumoe/edgetts@sha256:<digest>
```

### Release Promotion Lifecycle

edgeTTS enforces a strict two-stage promotion lifecycle for official releases:

1. **Candidate Verification**: Tag builds compile and publish a commit-addressed candidate (`:sha-<git-sha>`), followed by exhaustive multi-architecture verification (`linux/amd64`, `linux/arm64`), non-root UID checks, attestation validation, and security scans.
2. **Zero-Rebuild Promotion**: Upon verification success, `:X.Y.Z` and `:latest` aliases are promoted directly to the verified OCI index digest via `docker buildx imagetools create` with zero recompilation, preserving provenance, SBOM, and byte-for-byte content identity.
3. **Governance Protections**: Release tags must be ancestors of `origin/main`, moved tags are rejected, and existing release versions cannot be overwritten. See the [Release Governance Guide](docs/releasing.md) for full operational details.

### Registry Authentication & Security by Construction

For public releases, pulling from GitHub Container Registry requires no login:

```bash
docker pull ghcr.io/dejavumoe/edgetts:main
```

If the package is private or when pulling in CI environments subject to GitHub rate limits, authenticate using a GitHub Personal Access Token (PAT) with `read:packages` scope:

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u <username> --password-stdin
```

> [!NOTE]
> The automated CI publishing workflow authenticates to GitHub Container Registry using GitHub's ephemeral `github.token` with scoped `packages: write` permissions. The token is used strictly by `docker/login-action` for registry authentication and is never passed to the Dockerfile as an `ARG`, `ENV`, secret mount, or build input.

## Docker

edgeTTS provides a hardened, multi-stage production Docker image running as a non-root user with a minimal Node 24 runtime, built-in healthcheck, and read-only container filesystem support.

### Build Image

```bash
docker build -t edgetts:local .
```

### Run Directly

Without authentication (for environments protected by external network policies or upstream reverse proxies):

```bash
docker run -d \
  --name edgetts \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --tmpfs /tmp \
  -p 127.0.0.1:8080:8080 \
  edgetts:local
```

With optional API key authentication:

```bash
docker run -d \
  --name edgetts \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --tmpfs /tmp \
  -e API_KEY='replace-with-a-random-secret' \
  -p 127.0.0.1:8080:8080 \
  edgetts:local
```

### Docker Compose

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
2. Edit `.env` to configure your API key (by default `REQUIRE_API_KEY=true` is enforced, requiring a valid `API_KEY` with at least 16 characters). To run unauthenticated, explicitly set `REQUIRE_API_KEY=false`.
3. Start the service:
   ```bash
   docker compose up -d --build
   ```
4. Check status and logs:
   ```bash
   docker compose ps
   docker compose logs -f edgetts
   ```
5. Stop the service:
   ```bash
   docker compose down
   ```

### Security & Deployment Notes

- **Port Binding**: Compose defaults to `127.0.0.1:8080` (loopback only) so that traffic is routed through a reverse proxy (such as Nginx, Caddy, or Cloudflare Tunnel). If you change `EDGETTS_BIND_ADDRESS` to `0.0.0.0`, the port will be exposed directly to all public network interfaces.
- **Fail-Closed Compose**: Docker Compose enforces fail-closed authentication by default (`REQUIRE_API_KEY=true`). If `API_KEY` is not set or invalid, container startup terminates with an error before opening the port. To run unauthenticated, explicitly set `REQUIRE_API_KEY=false` in `.env`.
- **TLS Termination**: Production TLS / SSL certificates and HTTPS termination should be handled outside this container by your reverse proxy or tunnel.
- **Container Environment**: The container environment is configured with `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=8080`, and `WEB_DIST_DIR=/app/web-dist`. Users configure `API_KEY`, `EDGETTS_BIND_ADDRESS`, and `EDGETTS_HOST_PORT` in `.env`. Do not change the container internal `HOST` to `127.0.0.1`, or external container traffic will not be reachable.

### Reverse Proxy (Nginx)

For production deployments behind Nginx, a verified reverse proxy configuration template with streaming optimizations and TLS termination is provided in [`deploy/nginx/edgetts.conf.example`](deploy/nginx/edgetts.conf.example). See the [Nginx Deployment Guide](deploy/nginx/README.md) for step-by-step instructions.

## Validation

Run full workspace validation:

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
git diff --check
```

### Live Smoke Tests

Run smoke test against live Microsoft Edge TTS upstream:

```bash
# Edge TTS provider adapter smoke test
pnpm --filter @edgetts/edge-provider smoke

# TTS orchestration service smoke test
pnpm --filter @edgetts/tts-service smoke

# Fastify server HTTP API & static hosting smoke test
pnpm --filter @edgetts/server smoke
```

## Continuous Integration

edgeTTS runs an automated, credential-free GitHub Actions workflow (`.github/workflows/ci.yml`) on:

- Pushes to the `main` branch
- Release tags matching `v*.*.*`
- Pull requests
- Manual workflow dispatches (`workflow_dispatch`)

The pipeline executes up to four jobs:

1. **`quality`**: Frozen-lockfile dependency installation, workspace build, TypeScript typecheck, ESLint, test suites, Prettier formatting verification, and repository cleanliness audits.
2. **`docker`**: Multi-stage production container build, non-root user and healthcheck metadata inspection, fail-closed startup validation (`REQUIRE_API_KEY=true`), and runtime security posture checks (read-only rootfs, dropped capabilities, no-new-privileges).
3. **`proxy-contract`**: Containerized `nginx -t` validation and deterministic proxy tests via `EDGETTS_NGINX_SKIP_LIVE=1 ./deploy/nginx/test-proxy.sh` (validating TLS termination, chunk streaming, and HTTP 400/503/429 status preservation).
4. **`publish`** (Multi-Arch GHCR Release): Runs strictly on `main` branch pushes or `v*.*.*` release tags after all three validation gates succeed. Enforces release governance (strict SemVer, immutability, origin/main ancestry). Builds multi-arch images for `linux/amd64` and `linux/arm64`, attaches BuildKit SLSA provenance (`mode=max`) and SPDX SBOM attestations, pushes the commit candidate (`:sha-<git-sha>`), verifies manifest digests, non-root execution, and security posture across platforms under QEMU, and promotes verified stable aliases (`:X.Y.Z` and `:latest`) with zero rebuild. See [`docs/releasing.md`](docs/releasing.md).

> [!NOTE]
> Live speech synthesis against Microsoft Edge TTS endpoints is intentionally excluded from automated CI to eliminate external network fragility and rate limit dependencies from pull request gating. Full upstream live qualification remains available locally in controlled environments via `./deploy/nginx/test-proxy.sh` and the package smoke test scripts.
