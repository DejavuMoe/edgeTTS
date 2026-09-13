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

| Variable       | Description                                                                                 | Default                                                       |
| -------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `HOST`         | Bind address for Fastify server                                                             | `127.0.0.1`                                                   |
| `PORT`         | Listening port for Fastify server                                                           | `8080`                                                        |
| `NODE_ENV`     | Environment mode (`production`, `development`, `test`)                                      | Unset by default; static hosting auto-enabled in `production` |
| `SERVE_STATIC` | Explicit toggle for static web hosting (`true` / `false`)                                   | Unset (explicit override; auto-enabled in `production`)       |
| `WEB_DIST_DIR` | Absolute or relative path to web static assets directory                                    | `../../web/dist` relative to server                           |
| `API_KEY`      | Optional Bearer secret protecting synthesis & voices APIs (>= 16 characters, no whitespace) | Unset (authentication disabled)                               |

## Authentication

EdgeTTS provides an optional, stateless Bearer API key authentication layer:

- **When `API_KEY` is unset**: Authentication is completely disabled. All endpoints retain open unauthenticated behavior.
- **When `API_KEY` is configured**: Protected synthesis and voice discovery APIs require a valid Bearer token in the `Authorization` header (`Authorization: Bearer <API_KEY>`).

### Endpoint Access Policy

- **Public Endpoints** (never require authentication):
  - `GET /health` (Container / orchestrator uptime probe)
  - `GET /api/health`
  - Static WebUI (`/`, `/assets/*`, and client SPA routes)
- **Protected Endpoints** (require Bearer key when `API_KEY` is configured):
  - `GET /api/voices`
  - `POST /api/speech`
  - `POST /v1/audio/speech`

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

### Reverse Proxy & Private Network Deployment

If your deployment is already protected by an external reverse proxy authentication layer (e.g. Authelia, Cloudflare Access) or private network/VPN, setting `API_KEY` can be omitted. Note that when `API_KEY` is unset, application APIs are unauthenticated.

> [!NOTE]
> API key authentication provides access control but does not perform rate limiting or per-user quota management. Rate limiting remains intentionally deferred.

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
