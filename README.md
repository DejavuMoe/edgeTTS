# EdgeTTS

Self-hosted Edge TTS Web application and API skeleton.

> **Note:** `POST /v1/audio/speech` currently implements an OpenAI-compatible subset.

## Architecture

- `apps/server`: Fastify HTTP API service (`@edgetts/server`), providing `GET /api/health`, `GET /api/voices`, and `POST /v1/audio/speech` backed by `TtsService` and `EdgeTtsProvider`.
- `apps/web`: React + Vite frontend application (`@edgetts/web`).
- `packages/shared`: Shared TypeScript types and Zod schemas (`@edgetts/shared`).
- `packages/tts-core`: Provider-neutral TTS domain contracts (`@edgetts/tts-core`), defining synthesis controls: `speed` (0.5–2.0), `pitchSemitones` (-12–12), and `volume` (0–1).
- `packages/edge-provider`: Microsoft Edge Read Aloud adapter (`@edgetts/edge-provider`), mapping domain prosody controls to `msedge-tts`.
- `packages/tts-service`: Provider-independent application service (`@edgetts/tts-service`), providing cached voice discovery, configurable in-memory voice TTL, concurrent voice-fetch de-duplication, bounded FIFO synthesis concurrency limiting (4 active, 16 queued), a lossless text segmentation primitive, and provider-neutral synthesis delegation.

## Text Segmentation

- Provider-independent lossless text segmentation primitive (`segmentText`) measuring limits in Unicode code points.
- Natural boundary hierarchy: paragraph (`\n\n`, `\r\n\r\n`) > line (`\n`, `\r\n`) > sentence (`.!?。！？;；` with closing quotes) > whitespace > hard split.
- Strictly lossless: rejoining chunks (`chunks.join("")`) reproduces the exact original text without mutation or trimming.
- CRLF atomicity: CRLF pairs are preserved atomically whenever `maxCodePoints >= 2`; with `maxCodePoints = 1`, preserving the hard chunk size limit takes precedence.
- Algorithm & complexity: linear $O(N)$ code-point indexing and boundary pre-scanning followed by monotonic binary-search cursor segmentation ($O(N \log N)$ worst-case, $O(N)$ for non-trivial chunk sizes).
- Note: The segmenter is not yet wired into speech synthesis. `POST /v1/audio/speech` remains limited to 4096 characters.

## Synthesis Concurrency

- Concurrency limit: 4 active synthesis streams per `TtsService` instance.
- Waiting queue: up to 16 queued synthesis requests in strict FIFO order.
- Queued cancellation: client disconnect cancels queued requests and frees queue capacity immediately.
- Capacity exhaustion: excess requests when capacity is full receive `HTTP 503 SERVER_BUSY`.
- Scope: per-instance in-memory limiter; values are currently fixed defaults and are not environment-configurable yet.

## API Endpoints

### `GET /api/health`

Health check endpoint returning `{ "status": "ok" }`.

### `GET /api/voices`

Returns cached Edge TTS voices in `{ "voices": [...] }`.

### `POST /v1/audio/speech`

OpenAI-compatible speech endpoint subset with MP3 streaming.

**Supported options:**

- `model`: `tts-1` (mapped to `mp3-48k`) or `tts-1-hd` (mapped to `mp3-96k`)
- `voice`: Edge TTS ShortName (e.g. `zh-CN-XiaoxiaoNeural`, `en-US-JennyNeural`)
- `input`: Plain text (1–4096 characters, non-empty)
- `response_format`: `mp3` (optional, default: `mp3`)
- `speed`: `0.5`–`2.0` (optional, default: `1.0`)

**Unsupported options:**

- `instructions`
- `stream_format`
- non-MP3 output (`opus`, `aac`, `flac`, `wav`, `pcm`, `webm`)
- long-text chunking (> 4096 characters)
- authentication

**Example usage:**

```bash
curl \
  -H 'Content-Type: application/json' \
  -d '{
    "model":"tts-1",
    "voice":"zh-CN-XiaoxiaoNeural",
    "input":"你好，世界。",
    "response_format":"mp3",
    "speed":1
  }' \
  http://127.0.0.1:8080/v1/audio/speech \
  --output speech.mp3
```

## Requirements

- Node.js (v24 LTS recommended)
- pnpm (v10+ or v12+)

## Install

```bash
pnpm install
```

## Development

Start both the Fastify server and Vite dev server concurrently:

```bash
pnpm dev
```

- Server: `http://127.0.0.1:8080`
- Web UI: Vite local dev server (proxies `/api` to `http://127.0.0.1:8080`)

## Validation

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

To run the live Edge TTS provider smoke test against the Microsoft endpoint:

```bash
pnpm --filter @edgetts/edge-provider smoke
```

To run the live TTS service smoke test:

```bash
pnpm --filter @edgetts/tts-service smoke
```

To run the live Fastify server smoke test:

```bash
pnpm --filter @edgetts/server smoke
```
