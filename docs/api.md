# API Reference & Integration Guide

This guide details all HTTP API endpoints, request/response contracts, and client integration examples for `edgeTTS`.

---

## Endpoints Overview

| Method | Path               | Auth Required      | Description                                       |
| :----- | :----------------- | :----------------- | :------------------------------------------------ |
| `GET`  | `/health`          | No                 | Basic health check returning `{"status":"ok"}`    |
| `GET`  | `/api/health`      | No                 | Prefixed health check returning `{"status":"ok"}` |
| `GET`  | `/api/voices`      | Yes (when enabled) | List available Edge TTS voices                    |
| `POST` | `/v1/audio/speech` | Yes (when enabled) | OpenAI-compatible streaming speech synthesis      |
| `POST` | `/api/speech`      | Yes (when enabled) | Native segmented long-text streaming synthesis    |

---

## Authentication

When authentication is enabled (`REQUIRE_API_KEY=true`), requests must include the API key in the standard `Authorization` header:

```http
Authorization: Bearer <API_KEY>
```

If the key is missing or invalid, the server responds with HTTP `401 Unauthorized`:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing or invalid API key"
  }
}
```

---

## 1. OpenAI-Compatible Speech API (`POST /v1/audio/speech`)

This endpoint adheres to the OpenAI Audio Speech API contract, allowing drop-in compatibility with LLM workbench tools, AI agents, and third-party frontend applications.

### Request Body (JSON)

| Parameter         | Type     | Required | Description                                                                                    |
| :---------------- | :------- | :------- | :--------------------------------------------------------------------------------------------- |
| `model`           | `string` | **Yes**  | `"tts-1"` (standard, 48 kbps) or `"tts-1-hd"` (high quality, 96 kbps)                          |
| `voice`           | `string` | **Yes**  | Edge voice identifier (e.g. `zh-CN-XiaoxiaoNeural`, `en-US-JennyNeural`, `ja-JP-NanamiNeural`) |
| `input`           | `string` | **Yes**  | Text to synthesize (1–4,096 characters, XML-compatible)                                        |
| `response_format` | `string` | No       | `"mp3"` (default and only supported format)                                                    |
| `speed`           | `number` | No       | Playback speed from `0.5` to `2.0` (default: `1.0`)                                            |

### cURL Example

```bash
curl -X POST http://127.0.0.1:8080/v1/audio/speech \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tts-1",
    "voice": "zh-CN-XiaoxiaoNeural",
    "input": "你好，这是 edgeTTS 的 OpenAI 兼容接口测试。",
    "response_format": "mp3",
    "speed": 1.0
  }' \
  --output speech.mp3
```

### Official OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8080/v1",
    api_key="your-secret-api-key",
)

with client.audio.speech.with_streaming_response.create(
    model="tts-1",
    voice="zh-CN-XiaoxiaoNeural",
    input="Hello from the OpenAI Python SDK streaming through edgeTTS!",
) as response:
    response.stream_to_file("output.mp3")
```

### Official OpenAI Node.js / TypeScript SDK

```typescript
import fs from "node:fs";
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "http://127.0.0.1:8080/v1",
  apiKey: "your-secret-api-key",
});

async function main() {
  const response = await openai.audio.speech.create({
    model: "tts-1",
    voice: "en-US-JennyNeural",
    input: "Streaming speech directly from Node.js.",
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile("output.mp3", buffer);
}

void main();
```

### Third-Party Client Integration

- **NextChat (ChatGPT-Next-Web)**:
  - Settings -> TTS Settings -> Provider: **OpenAI**.
  - OpenAI Base URL: `https://edgetts.example.com/v1` (or local `http://127.0.0.1:8080/v1`).
  - API Key: Your configured `API_KEY`.
  - Model: `tts-1` or `tts-1-hd`.
  - Voice: Select or enter an Edge voice ID (e.g., `zh-CN-YunxiNeural`).
- **One API / New API**:
  - Add Channel -> Type: **OpenAI**.
  - Base URL: `http://127.0.0.1:8080`.
  - Key: Your configured `API_KEY`.
  - Models: `tts-1`, `tts-1-hd`.

---

## 2. Native Long-Text Streaming API (`POST /api/speech`)

This endpoint is tailored for long-form content (documents, articles, audiobooks) up to **20,000 Unicode code points** in a single HTTP streaming request.

### Server-Side Lossless Segmentation

When texts exceed 300 code points, the server automatically segments the input using a deterministic hierarchical boundary rule:
`Paragraph (\n\n) > Line Break (\n) > Sentence Boundary (. ! ? 。 ！？) > Whitespace > Hard Cut`

Segments are synthesized sequentially and concatenated over a continuous HTTP response stream. Rejoining the chunks produces the exact original text with zero character loss or mutation.

### Request Body (JSON)

| Parameter        | Type     | Required | Description                                                           |
| :--------------- | :------- | :------- | :-------------------------------------------------------------------- |
| `input`          | `string` | **Yes**  | Text to synthesize (1–20,000 Unicode code points, XML-compatible)     |
| `voice`          | `string` | **Yes**  | Edge voice identifier (e.g. `zh-CN-XiaoxiaoNeural`)                   |
| `quality`        | `string` | No       | `"standard"` (48 kbps MP3, default) or `"high"` (96 kbps MP3)         |
| `speed`          | `number` | No       | Speed factor from `0.5` to `2.0` (default: `1.0`)                     |
| `pitchSemitones` | `number` | No       | Pitch adjustment in semitones from `-12.0` to `12.0` (default: `0.0`) |
| `volume`         | `number` | No       | Volume scaling factor from `0.0` to `1.0` (default: `1.0`)            |

### Response Headers

- `Content-Type`: `audio/mpeg`
- `Cache-Control`: `no-store`
- `X-EdgeTTS-Segment-Count`: Total number of planned synthesis segments.
- `X-EdgeTTS-Segment-Max-Code-Points`: Maximum code point limit per segment (`300`).

### cURL Example

```bash
curl -X POST http://127.0.0.1:8080/api/speech \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "这是一段较长的文本。edgeTTS 将自动在服务端执行层次无损分段，并通过单个 HTTP 流顺畅地返回完整的音频文件。",
    "voice": "zh-CN-XiaoxiaoNeural",
    "quality": "standard",
    "speed": 1.0,
    "pitchSemitones": 0.0,
    "volume": 1.0
  }' \
  --output long-speech.mp3
```

---

## 3. Voice Discovery API (`GET /api/voices`)

Returns the catalog of available Edge TTS voices. Results are cached in memory for 6 hours.

### cURL Example

```bash
curl -s http://127.0.0.1:8080/api/voices \
  -H "Authorization: Bearer $API_KEY"
```

### Response Example

```json
{
  "voices": [
    {
      "id": "zh-CN-XiaoxiaoNeural",
      "displayName": "Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)",
      "locale": "zh-CN",
      "gender": "Female",
      "status": "GA",
      "suggestedCodec": "audio-24khz-48kbitrate-mono-mp3"
    },
    {
      "id": "en-US-JennyNeural",
      "displayName": "Microsoft Jenny Online (Natural) - English (United States)",
      "locale": "en-US",
      "gender": "Female",
      "status": "GA",
      "suggestedCodec": "audio-24khz-48kbitrate-mono-mp3"
    }
  ]
}
```

---

## 4. Health Check API (`GET /health`, `GET /api/health`)

Lightweight probes for Docker container healthchecks, Kubernetes liveness/readiness probes, and reverse proxy upstream monitoring.

### cURL Example

```bash
curl -i http://127.0.0.1:8080/health
```

### Response

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{"status":"ok"}
```

---

## Error Handling & Status Codes

All errors return standard JSON payloads adhering to the `ApiError` schema:

```json
{
  "error": {
    "code": "ERROR_CODE_STRING",
    "message": "Human readable error message"
  }
}
```

| HTTP Status               | Code              | Cause                                                                                         |
| :------------------------ | :---------------- | :-------------------------------------------------------------------------------------------- |
| `400 Bad Request`         | `INVALID_REQUEST` | Validation error (e.g. text exceeds length bounds, invalid characters, invalid voice format). |
| `401 Unauthorized`        | `UNAUTHORIZED`    | Missing or invalid API key in `Authorization: Bearer` header.                                 |
| `404 Not Found`           | —                 | Route or asset does not exist.                                                                |
| `429 Too Many Requests`   | `RATE_LIMITED`    | Exceeded admission rate limit (default 12 requests per 10s per process).                      |
| `502 Bad Gateway`         | `UPSTREAM_ERROR`  | Upstream Microsoft Edge TTS WebSocket connection failure or synthesis rejection.              |
| `503 Service Unavailable` | `SERVER_BUSY`     | Synthesis concurrency queue is full (exceeded 4 active + 16 queued requests).                 |
