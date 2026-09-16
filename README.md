# edgeTTS

[![Release](https://img.shields.io/github/v/release/DejavuMoe/edgeTTS?color=blue)](https://github.com/DejavuMoe/edgeTTS/releases)
[![CI Status](https://img.shields.io/github/actions/workflow/status/DejavuMoe/edgeTTS/ci.yml?branch=main)](https://github.com/DejavuMoe/edgeTTS/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Docker GHCR](https://img.shields.io/badge/docker-GHCR-blue.svg)](https://github.com/DejavuMoe/edgeTTS/pkgs/container/edgetts)
[![Node Version](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](package.json)

English | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

edgeTTS is a high-performance, self-hosted web service and interactive workbench for Microsoft Edge speech synthesis. It provides a drop-in OpenAI-compatible TTS endpoint, a native streaming API for long documents up to 20,000 code points, and an accessible browser workbench.

> [!NOTE]
> edgeTTS relies on the Microsoft Edge TTS online service. Upstream availability and voice catalogs are maintained by Microsoft. edgeTTS is an independent open-source project and is not affiliated with or endorsed by Microsoft.

---

## Key Features

- **Dual Speech API**:
  - **OpenAI-Compatible Endpoint** (`POST /v1/audio/speech`): Drop-in replacement for OpenAI TTS clients supporting `tts-1` (48 kbps) and `tts-1-hd` (96 kbps), Edge voices, speed adjustment (0.5–2.0), and chunked streaming.
  - **Native Long-Text Streaming API** (`POST /api/speech`): Synthesize up to 20,000 Unicode code points in a single HTTP request with lossless server-side segmentation, fine prosody controls (`speed`, `pitchSemitones`, `volume`), and segment metadata headers.
- **Lossless Text Segmentation**:
  - Deterministic boundary segmentation (`paragraph > line break > sentence punctuation > whitespace > hard cut`) with Unicode code-point precision preserving surrogate pairs and CRLF atomicity. Rejoining chunks reproduces the original text exactly.
- **Fair Concurrency Control**:
  - Built-in in-memory FIFO limiter (4 concurrent streams, 16 waiting slots). Long-text sessions hold 1 permit across their full stream to prevent mid-stream interruptions. Client disconnections abort upstream synthesis immediately.
- **Web Workbench**:
  - Browser-neutral visual design system ("warm-paper" palette) with custom accessible controls (`Select`, `Slider`, `Checkbox`, `AudioPlayer`).
  - Searchable voice catalog with locale filtering and favorites pinning.
  - Local UTF-8 `.txt` file import (up to 256 KiB / 20,000 code points, parsed entirely in the browser).
  - Progressive `MediaSource` streaming playback with automatic Blob fallback, seek slider, and clean MP3 downloads.
- **Production Hardened**:
  - Single-origin architecture: Fastify serves both the frontend SPA and API routes under a single port.
  - Privacy-first: Zero logging of user synthesis text, no analytics, no external telemetry.
  - Constant-time API key verification (`Authorization: Bearer <API_KEY>`).
  - Container security: Non-root user `node`, read-only rootfs, dropped capabilities, and no-new-privileges.

---

## Quick Start

### Method A: Docker Compose with Pre-built Image (Recommended)

Create a directory and define `compose.yaml`:

```bash
mkdir -p ~/edgetts && cd ~/edgetts
```

```yaml
services:
  edgetts:
    image: ghcr.io/dejavumoe/edgetts:0.3.0
    container_name: edgetts
    restart: unless-stopped
    init: true
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    tmpfs:
      - /tmp
    stop_grace_period: 30s
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      - NODE_ENV=production
      - HOST=0.0.0.0
      - PORT=8080
      - API_KEY=${API_KEY}
      - REQUIRE_API_KEY=true
```

Generate a secure random API key and start the container:

```bash
echo "API_KEY=$(openssl rand -hex 32)" > .env
docker compose up -d
```

### Method B: Single Container (`docker run`)

```bash
export API_KEY="$(openssl rand -hex 32)"

docker run -d \
  --name edgetts \
  --restart unless-stopped \
  --init \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --tmpfs /tmp \
  --stop-timeout 30 \
  -p 127.0.0.1:8080:8080 \
  -e API_KEY="$API_KEY" \
  -e REQUIRE_API_KEY=true \
  ghcr.io/dejavumoe/edgetts:0.3.0
```

> [!IMPORTANT]
> **Loopback Binding (`127.0.0.1:8080:8080`)**: Binding to `127.0.0.1` ensures the container is accessible only from the local host. For public internet access, place an HTTPS reverse proxy (such as Nginx or Caddy) in front.

### Verify Deployment

```bash
curl -i http://127.0.0.1:8080/health
```

Expected response: `HTTP/1.1 200 OK` with `{"status":"ok"}`.

Open `http://127.0.0.1:8080` in your web browser to access the Web Workbench.

---

## API Usage at a Glance

### OpenAI-Compatible Synthesis (`POST /v1/audio/speech`)

```bash
curl -X POST http://127.0.0.1:8080/v1/audio/speech \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tts-1",
    "voice": "zh-CN-XiaoxiaoNeural",
    "input": "你好，世界！这是一段测试文本。",
    "response_format": "mp3",
    "speed": 1.0
  }' \
  --output speech.mp3
```

#### Official OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8080/v1",
    api_key="your-secret-api-key",
)

with client.audio.speech.with_streaming_response.create(
    model="tts-1",
    voice="zh-CN-XiaoxiaoNeural",
    input="Hello from edgeTTS streaming synthesis!",
) as response:
    response.stream_to_file("speech.mp3")
```

### Native Long-Text Streaming Synthesis (`POST /api/speech`)

```bash
curl -X POST http://127.0.0.1:8080/api/speech \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "这是一篇长篇文档的内容。edgeTTS 会在服务端无损分段并通过单个 HTTP 连接流式返回完整音频。",
    "voice": "zh-CN-XiaoxiaoNeural",
    "quality": "standard",
    "speed": 1.0,
    "pitchSemitones": 0.0,
    "volume": 1.0
  }' \
  --output long-speech.mp3
```

---

## Documentation

Comprehensive guides are available in the [`docs/`](docs/) directory:

| Document                                               | Description                                                                         |
| :----------------------------------------------------- | :---------------------------------------------------------------------------------- |
| [**Self-Hosted Deployment Guide**](docs/deployment.md) | Docker Compose, single container, source build, and bare-metal systemd setups.      |
| [**Reverse Proxy & TLS Guide**](docs/reverse-proxy.md) | Production Nginx and Caddy setups, streaming buffer rules, and test scripts.        |
| [**Configuration Reference**](docs/configuration.md)   | Environment variables, authentication, rate limits, and concurrency queues.         |
| [**API Reference & Integrations**](docs/api.md)        | Endpoint specifications, schemas, error codes, and third-party client integrations. |
| [**Release Governance & Security**](docs/releasing.md) | SemVer policies, OCI supply-chain attestations, and immutable digest pinning.       |

---

## Architecture

```text
HTTP Route (apps/server)
       ↓
  TtsService (packages/tts-service)
       ↓
  TtsProvider (packages/tts-core)
       ↓
EdgeTtsProvider (packages/edge-provider)
       ↓
   msedge-tts (Upstream WebSocket)
```

- `apps/server`: Fastify composition root, HTTP routing, rate-limiting, and static file hosting.
- `apps/web`: React + Vite SPA workbench featuring browser-neutral accessible UI primitives.
- `packages/tts-service`: Provider-neutral orchestration (voice caching, concurrency limiter, text segmentation).
- `packages/tts-core`: Domain abstractions and port definitions.
- `packages/edge-provider`: Microsoft Edge Read Aloud WebSocket provider adapter.
- `packages/shared`: Shared validation schemas, types, and Unicode text processing utilities.

---

## License

This project is licensed under the [MIT License](LICENSE).
