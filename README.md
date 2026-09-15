# edgeTTS

English | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

edgeTTS is a self-hosted web application and streaming HTTP speech synthesis service built on Microsoft Edge TTS / Edge Read Aloud capabilities.

It provides an interactive web workbench, a native segmented speech API for long texts, an OpenAI-compatible speech endpoint subset, and production container deployment options.

> [!NOTE]
> edgeTTS relies on Microsoft's Edge TTS upstream service. Upstream availability, voices, and behavior are outside this project's control. edgeTTS is an independent open-source project and is not affiliated with or endorsed by Microsoft.

Current stable release: [v0.2.0](https://github.com/DejavuMoe/edgeTTS/releases/tag/v0.2.0)

---

## Features

- **Dual Speech API**:
  - **OpenAI-Compatible TTS Subset** (`POST /v1/audio/speech`): OpenAI-compatible endpoint subset supporting `tts-1` (`mp3-48k`) and `tts-1-hd` (`mp3-96k`) models, Edge voice IDs, input texts (1–4,096 characters), and speed adjustment (0.5–2.0).
  - **Native Long-Text Streaming API** (`POST /api/speech`): Synthesize up to 20,000 Unicode code points in a single streaming HTTP request with standard (`mp3-48k`) or high (`mp3-96k`) quality, prosody controls (`speed`, `pitchSemitones`, `volume`), and deterministic segment plan metadata headers.
- **Lossless Text Segmentation**:
  - Hierarchical boundary segmentation (`paragraph > line > sentence > whitespace > hard cut`) with Unicode code-point precision preserving surrogate pairs and CRLF atomicity.
  - Rejoining chunks reproduces the original input text without mutation or trimming.
- **Fair Concurrency Control**:
  - Built-in in-memory FIFO limiter (4 active synthesis streams, 16 queue slots).
  - Segmented synthesis acquires and releases concurrency permits per segment, preventing single long requests from monopolizing capacity.
  - Client disconnections abort queued requests and active upstream streams immediately.
- **Web Workbench**:
  - React single-page application with dual-mode playback: progressive `MediaSource` streaming playback with automatic Blob fallback.
  - Voice discovery with locale filtering, search, and favorites pinning.
  - Local UTF-8 `.txt` file import (client-side reading up to 256 KiB / 20,000 code points; contents are never uploaded or stored).
  - Keyboard shortcuts: `Ctrl+Enter` / `Cmd+Enter` to synthesize, `Escape` to cancel.
  - Real-time text statistics and streaming telemetry (request/streaming status, planned segment count, and actual received audio byte size).
- **Single-Origin Production Hosting**:
  - Fastify hosts built frontend assets (`apps/web/dist`) and API endpoints under a single port/domain.
  - Immutable caching for hashed assets, revalidation caching for `index.html`, and non-interfering SPA fallback routing.
- **Security & Privacy**:
  - No input-text logging, analytics, or external telemetry collection; inputs and credentials are never persisted to disk.
  - Optional API key authentication via the `Authorization: Bearer <API_KEY>` header with constant-time verification.
  - Production container posture: non-root `node` user, read-only root filesystem, dropped Linux capabilities (`ALL`), and `no-new-privileges`.

---

## Quick Start (Recommended Docker Image)

The fastest and recommended way to deploy edgeTTS is using the official pre-built multi-arch container image from GitHub Container Registry (GHCR).

### 1. Generate an API Key

```bash
openssl rand -hex 32
```

### 2. Start Container

```bash
export EDGETTS_API_KEY='<generated-secret>'

docker run -d \
  --name edgetts \
  --restart unless-stopped \
  --init \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --tmpfs /tmp \
  --stop-timeout 30 \
  -e API_KEY="$EDGETTS_API_KEY" \
  -e REQUIRE_API_KEY=true \
  -p 127.0.0.1:8080:8080 \
  ghcr.io/dejavumoe/edgetts:0.2.0
```

### 3. Verify Deployment

```bash
curl http://127.0.0.1:8080/health
```

Expected response:

```json
{ "status": "ok" }
```

Open `http://127.0.0.1:8080` in your browser to access the Web Workbench.

> [!IMPORTANT]
> **Loopback Binding (`127.0.0.1:8080:8080`)**: Binding to `127.0.0.1` ensures edgeTTS is only accessible locally and not exposed directly to the public internet. For public internet deployments, place an HTTPS reverse proxy (such as Nginx) in front to terminate TLS.

### Container Image Tags & Digests

| Reference                                           | Purpose                                               | Mutability                    |
| --------------------------------------------------- | ----------------------------------------------------- | ----------------------------- |
| `ghcr.io/dejavumoe/edgetts:0.2.0`                   | Recommended for normal stable production deployments  | Release tag                   |
| `ghcr.io/dejavumoe/edgetts@sha256:<release-digest>` | Strict immutable content-addressed production pinning | Content-addressed (immutable) |
| `ghcr.io/dejavumoe/edgetts:latest`                  | Tracks the highest published stable SemVer release    | Movable tag                   |
| `ghcr.io/dejavumoe/edgetts:main`                    | Latest development build verified from `main`         | Floating snapshot             |

For an immutable deployment pin, use `ghcr.io/dejavumoe/edgetts@sha256:<release-digest>`; each stable release's verified digest is recorded in its [GitHub Release notes](https://github.com/DejavuMoe/edgeTTS/releases).

---

## Installation & Deployment Methods

### Method 1: Pre-built Docker Image (GHCR)

See the [Quick Start](#quick-start-recommended-docker-image) section above.

### Method 2: Docker Compose (Build from Source)

The repository provides a `compose.yaml` configured to build a local container image from the project source tree.

```bash
git clone https://github.com/DejavuMoe/edgeTTS.git
cd edgeTTS

cp .env.example .env
```

Generate a secure API key:

```bash
openssl rand -hex 32
```

Edit `.env` to set your secret:

```env
API_KEY=replace-with-your-generated-secret
REQUIRE_API_KEY=true
EDGETTS_BIND_ADDRESS=127.0.0.1
EDGETTS_HOST_PORT=8080
```

Start the service:

```bash
docker compose up -d --build
```

Manage the container:

```bash
# Check status
docker compose ps

# View logs
docker compose logs -f edgetts

# Verify health
curl http://127.0.0.1:8080/health

# Stop service
docker compose down
```

### Method 3: Production from Source (Node.js & pnpm)

#### Prerequisites

- **Node.js**: `24` LTS
- **pnpm**: `12.3.4` (matches root `package.json` `packageManager`)

#### Build and Start

```bash
git clone https://github.com/DejavuMoe/edgeTTS.git
cd edgeTTS

# Install dependencies and compile all packages and web frontend
pnpm install --frozen-lockfile
pnpm build

# Generate secret
export API_KEY="$(openssl rand -hex 32)"

# Run production server
NODE_ENV=production \
HOST=127.0.0.1 \
PORT=8080 \
API_KEY="$API_KEY" \
REQUIRE_API_KEY=true \
node apps/server/dist/server.js
```

> [!NOTE]
> In bare Node.js, `HOST` defaults to `127.0.0.1` and `REQUIRE_API_KEY` defaults to `false`. For production environments, always set `REQUIRE_API_KEY=true` and configure `API_KEY`.

### Method 4: Local Development

Run the Fastify server and Vite dev server concurrently with hot reload:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

- **Backend API**: `http://127.0.0.1:8080`
- **Vite Web Workbench**: `http://localhost:5173` (proxies `/api` and `/v1` to port 8080)

---

## Production Reverse Proxy (Nginx)

For internet-facing production deployments, terminate TLS with Nginx and proxy traffic to edgeTTS bound on `127.0.0.1:8080`:

```text
Internet (Clients / Browsers / API Consumers)
                      │
               HTTPS (Port 443)
                      ▼
             Nginx Reverse Proxy
                      │
            HTTP/1.1 (127.0.0.1:8080)
                      ▼
               edgeTTS Service
```

### Setup Steps (Debian / Ubuntu)

```bash
# 1. Copy configuration template
sudo cp deploy/nginx/edgetts.conf.example /etc/nginx/sites-available/edgetts.conf
sudo ln -s /etc/nginx/sites-available/edgetts.conf /etc/nginx/sites-enabled/edgetts.conf

# 2. Edit domain name and TLS certificate paths
sudo nano /etc/nginx/sites-available/edgetts.conf

# 3. Test syntax
sudo nginx -t

# 4. Reload Nginx
sudo systemctl reload nginx
```

### Critical Streaming Proxy Rule

In `deploy/nginx/edgetts.conf.example`, response buffering is disabled **specifically** for streaming speech endpoints:

```nginx
location = /api/speech {
    proxy_pass http://edgetts_backend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
    proxy_send_timeout 60s;
}

location = /v1/audio/speech {
    proxy_pass http://edgetts_backend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
    proxy_send_timeout 60s;
}
```

> [!WARNING]
> Do **not** disable buffering globally (`proxy_buffering off;` under `location /`). Retain default buffering for web UI static assets and metadata queries, disabling it only on `/api/speech` and `/v1/audio/speech`.

See [`deploy/nginx/README.md`](deploy/nginx/README.md) for automated verification and test instructions. Other reverse proxies can be used if they preserve incoming `Authorization` headers and do not buffer streaming audio responses.

---

## Authentication

When authentication is enabled (`REQUIRE_API_KEY=true`), requests must provide the API key using the HTTP `Authorization` header:

```http
Authorization: Bearer <API_KEY>
```

- **Query parameter authentication is not supported** (no `?api_key=` or `?token=`).
- **Public endpoints**: `GET /health`, `GET /api/health`, and static Workbench (`GET /`).
- **Protected endpoints**: `GET /api/voices`, `POST /api/speech`, and `POST /v1/audio/speech`.
- Key verification uses constant-time comparison (`crypto.timingSafeEqual`) to prevent timing side-channel attacks. Minimum API key length is 16 characters with no whitespace.
- **Web Workbench API Key**: Entered directly in the workbench settings. The key is kept strictly in transient browser memory (React state) and is never written to `localStorage`, `sessionStorage`, cookies, or the URL. It must be re-entered if the page is refreshed.

---

## Web Workbench

The built-in workbench provides an interactive interface for synthesis:

- **Voice Discovery**: Search across voice names, IDs, and locales; filter by language/region; toggle voice favorites (persisted in browser storage); and maintain selected voice stability across reloads.
- **Prosody Controls**: Fine-tune `speed` (0.5–2.0), `pitch` (-12 to +12 semitones), and `volume` (0–1).
- **Quality Selection**: Choose between standard (`mp3-48k`) and high (`mp3-96k`) audio quality.
- **Local UTF-8 TXT Import**: Import text directly from `.txt` files up to 256 KiB and 20,000 Unicode code points. Files are decoded in the browser via `TextDecoder('utf-8', { fatal: true })` and are never uploaded or stored on disk.
- **Keyboard Shortcuts**: `Ctrl+Enter` (Windows/Linux) or `Cmd+Enter` (macOS) to synthesize text; `Escape` to cancel an in-progress synthesis.
- **Dual-Mode Audio Player**: Plays incoming audio progressively via `MediaSource` and `SourceBuffer`, falling back seamlessly to Blob object URLs when `MediaSource` is unsupported. Includes one-click MP3 download with sanitized filenames.
- **Streaming Telemetry**: Displays real-time status indicators (requesting state, streaming state, planned segment count, and actual received audio byte size). edgeTTS does not display fabricated percentages, estimated time of arrival (ETA), or completed-segment counters.

---

## API Reference

### Endpoint Overview

| Method | Path               | Auth Required      | Description                                           |
| ------ | ------------------ | ------------------ | ----------------------------------------------------- |
| `GET`  | `/health`          | No                 | Basic health check returning `{"status":"ok"}`        |
| `GET`  | `/api/health`      | No                 | API-prefixed health check returning `{"status":"ok"}` |
| `GET`  | `/api/voices`      | Yes (when enabled) | Cached list of available Edge TTS voices              |
| `POST` | `/v1/audio/speech` | Yes (when enabled) | OpenAI-compatible streaming TTS endpoint subset       |
| `POST` | `/api/speech`      | Yes (when enabled) | Native segmented long-text streaming speech API       |

### 1. OpenAI-Compatible TTS Endpoint (`POST /v1/audio/speech`)

An OpenAI-compatible endpoint subset streaming MP3 audio.

#### Request Parameters

- `model` (string, required): `"tts-1"` (maps to `mp3-48k`) or `"tts-1-hd"` (maps to `mp3-96k`).
- `voice` (string, required): Edge TTS voice ID (e.g. `zh-CN-XiaoxiaoNeural`, `en-US-JennyNeural`).
- `input` (string, required): Text to synthesize (1–4,096 characters).
- `response_format` (string, optional): Only `"mp3"` is supported (default: `"mp3"`).
- `speed` (number, optional): Playback speed from `0.5` to `2.0` (default: `1.0`).

#### Example Request

```bash
curl -X POST http://127.0.0.1:8080/v1/audio/speech \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tts-1",
    "voice": "zh-CN-XiaoxiaoNeural",
    "input": "你好，世界。",
    "response_format": "mp3",
    "speed": 1.0
  }' \
  --output speech.mp3
```

_(If authentication is disabled, omit the `Authorization` header.)_

### 2. Native Long-Text Speech API (`POST /api/speech`)

Synthesizes up to 20,000 Unicode code points. Long texts are losslessly segmented server-side and streamed sequentially over a single HTTP connection.

#### Request Parameters

- `input` (string, required): Plain text (1–20,000 Unicode code points).
- `voice` (string, required): Edge TTS voice ID.
- `quality` (string, optional): `"standard"` (`mp3-48k`, default) or `"high"` (`mp3-96k`).
- `speed` (number, optional): Speed factor from `0.5` to `2.0` (default: `1.0`).
- `pitchSemitones` (number, optional): Pitch shift in semitones from `-12.0` to `12.0` (default: `0.0`).
- `volume` (number, optional): Volume scaling from `0.0` to `1.0` (default: `1.0`).

#### Response Headers

Successful synthesis responses include planned segmentation metadata headers:

- `X-EdgeTTS-Segment-Count`: Total planned text segments.
- `X-EdgeTTS-Segment-Max-Code-Points`: Maximum code points per segment (`300`).

#### Example Request

```bash
curl -X POST http://127.0.0.1:8080/api/speech \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "这是一段较长的文本，服务端会在无损分段后通过单连接流式返回完整音频。",
    "voice": "zh-CN-XiaoxiaoNeural",
    "quality": "standard",
    "speed": 1.0,
    "pitchSemitones": 0.0,
    "volume": 1.0
  }' \
  --output long-speech.mp3
```

---

## Configuration Reference

### Fastify Server Runtime Variables

These variables configure the application server (`apps/server`):

| Variable                      | Description                            | Valid Values                           | Default                                       |
| ----------------------------- | -------------------------------------- | -------------------------------------- | --------------------------------------------- |
| `HOST`                        | IP address the HTTP server binds to    | IPv4 / IPv6 address                    | `127.0.0.1` (bare Node), `0.0.0.0` (Docker)   |
| `PORT`                        | Port the HTTP server listens on        | Port integer (1–65535)                 | `8080`                                        |
| `NODE_ENV`                    | Runtime environment mode               | `production`, `development`, `test`    | `undefined`                                   |
| `API_KEY`                     | Secret token for Bearer authentication | String (>= 16 chars, no whitespace)    | None                                          |
| `REQUIRE_API_KEY`             | Enforce API key verification           | `true` or `false`                      | `false` (bare Node), `true` (Compose default) |
| `SPEECH_RATE_LIMIT_MAX`       | Max speech requests allowed per window | Integer between `1` and `10000`        | `12`                                          |
| `SPEECH_RATE_LIMIT_WINDOW_MS` | Speech rate limit window duration      | Integer between `100` and `3600000` ms | `10000` (10 seconds)                          |
| `SERVE_STATIC`                | Enable Fastify static SPA web hosting  | `true` or `false`                      | Enabled when `NODE_ENV=production`            |
| `WEB_DIST_DIR`                | Filesystem path to built web assets    | Directory path                         | Relative `apps/web/dist`                      |

### Docker Compose Host Variables (`.env`)

These variables configure host-side container port binding in `compose.yaml`:

| Variable               | Description                                   | Default     |
| ---------------------- | --------------------------------------------- | ----------- |
| `EDGETTS_BIND_ADDRESS` | Host IP address for container port forwarding | `127.0.0.1` |
| `EDGETTS_HOST_PORT`    | Host port mapped to container port 8080       | `8080`      |

### Built-in Limits (In-Memory, Per-Process)

- **Speech Admission Rate Limit**: Default 12 requests per 10 seconds across `/v1/audio/speech` and `/api/speech`. Exceeding limits returns HTTP 429.
- **TtsService Concurrency Limiter**: Default 4 active synthesis streams and 16 queued requests. Long-text segmented synthesis acquires limiter permits per segment. Full queue returns HTTP 503.

---

## Container Architecture & Security

Official GHCR images support multi-architecture environments (`linux/amd64` and `linux/arm64`) and include attached cryptographic supply-chain attestations (SLSA provenance and SPDX SBOM).

### Security Hardening Measures

- **Non-Root Execution**: Container runs under unprivileged user `node` (UID/GID 1000:1000).
- **Read-Only Root Filesystem**: Enabled via `--read-only` or `read_only: true` in Compose.
- **Dropped Capabilities**: All Linux capabilities dropped (`--cap-drop=ALL`).
- **Privilege Escalation Blocked**: `no-new-privileges:true`.
- **Minimal Temp Storage**: Writable scratch storage mounted only on `/tmp` (`tmpfs`).
- **Init Process**: Uses `--init` to properly reap zombie child processes and handle signals.
- **Graceful Shutdown**: 30-second stop timeout allows active synthesis streams to drain.

---

## Repository Architecture

```text
HTTP Request (apps/server)
       ↓
  TtsService (packages/tts-service)
       ↓
  TtsProvider (packages/tts-core)
       ↓
EdgeTtsProvider (packages/edge-provider)
       ↓
   msedge-tts
```

- `apps/server`: Fastify HTTP server and composition root (`@edgetts/server`).
- `apps/web`: React + Vite frontend workbench application (`@edgetts/web`).
- `packages/shared`: Shared schemas, types, and Unicode utilities (`@edgetts/shared`).
- `packages/tts-core`: Domain interfaces and contracts (`@edgetts/tts-core`).
- `packages/edge-provider`: Microsoft Edge Read Aloud provider adapter (`@edgetts/edge-provider`).
- `packages/tts-service`: In-memory voice caching, concurrency limiting, and text segmentation service (`@edgetts/tts-service`).

---

## Documentation Links

- [Nginx Reverse Proxy Deployment Guide](deploy/nginx/README.md)
- [Release Governance & Rollback Procedure](docs/releasing.md)
- [GitHub Release v0.2.0](https://github.com/DejavuMoe/edgeTTS/releases/tag/v0.2.0)
- [MIT License](LICENSE)

---

## License

This project is licensed under the [MIT License](LICENSE).
