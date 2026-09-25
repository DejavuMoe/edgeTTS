# API Reference & Integration Guide

This guide details all HTTP API endpoints, request/response contracts, and client integration examples for `edgeTTS`.

## Endpoints Overview

| Method | Path               | Auth Required      | Description                                          |
| :----- | :----------------- | :----------------- | :--------------------------------------------------- |
| `GET`  | `/health`          | No                 | Basic health check returning `{"status":"ok"}`       |
| `GET`  | `/api/health`      | No                 | Prefixed health check returning `{"status":"ok"}`    |
| `GET`  | `/api/voices`      | Yes (when enabled) | List available Edge TTS voices                       |
| `POST` | `/v1/audio/speech` | Yes (when enabled) | OpenAI-compatible streaming speech synthesis         |
| `POST` | `/api/speech`      | Yes (when enabled) | Native segmented long-text streaming synthesis       |
| `GET`  | `/api/metrics`     | Yes (when enabled) | Prometheus metrics, only when `METRICS_ENABLED=true` |

The machine-readable [OpenAPI 3 description](../openapi.json) is generated from the validation schemas.

## Authentication

When `API_KEY` is configured, requests must include the API key in the standard `Authorization` header:

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

## 1. OpenAI-Compatible Speech API (`POST /v1/audio/speech`)

This endpoint supports the request fields listed below, not the entire OpenAI API. Use an Edge voice ID from `/api/voices`; built-in OpenAI voice aliases are not mapped. `tts-1` and `tts-1-hd` select 48/96 kbps MP3 output from Edge, not OpenAI models. Unknown fields and other formats are rejected. Clients must allow a custom base URL and Edge voice IDs.

### Request Body (JSON)

| Parameter         | Type     | Required | Description                                                                                    |
| :---------------- | :------- | :------- | :--------------------------------------------------------------------------------------------- |
| `model`           | `string` | **Yes**  | `"tts-1"` (standard, 48 kbps) or `"tts-1-hd"` (high quality, 96 kbps)                          |
| `voice`           | `string` | **Yes**  | Edge voice identifier (e.g. `zh-CN-XiaoxiaoNeural`, `en-US-JennyNeural`, `ja-JP-NanamiNeural`) |
| `input`           | `string` | **Yes**  | Text to synthesize (1–4,096 UTF-16 code units, XML-compatible)                                 |
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

## 2. Native Long-Text Streaming API (`POST /api/speech`)

This endpoint is tailored for long-form content (documents, articles, audiobooks) up to **20,000 Unicode code points** in a single HTTP streaming request.

Both speech endpoints split text at paragraph, line, sentence or whitespace boundaries, with a hard limit of 300 Unicode code points. The segmenter preserves the original text; synthesis skips whitespace-only segments. Segments are synthesized sequentially over one HTTP audio response.

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
- `X-EdgeTTS-Segment-Count`: Number of nonblank segments scheduled for synthesis, not completed segments.
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

## 4. Health Check API (`GET /health`, `GET /api/health`)

The health endpoints only confirm HTTP process liveness. They do not contact Microsoft or establish synthesis readiness.

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

## 5. Metrics API (`GET /api/metrics`)

Served only when `METRICS_ENABLED=true`, in the Prometheus text format, with the same Bearer authentication as the other protected routes. The metrics are listed in the [configuration reference](configuration.md#metrics).

```yaml
scrape_configs:
  - job_name: edgetts
    metrics_path: /api/metrics
    authorization:
      credentials_file: /etc/prometheus/edgetts-api-key
    static_configs:
      - targets: ["127.0.0.1:8080"]
```

## Error Handling & Status Codes

Errors before audio headers use the JSON shape below. Later errors terminate the connection; an initial 200 does not prove a complete download. Discard interrupted audio and retry explicitly.

```json
{ "error": { "code": "INVALID_REQUEST", "message": "Invalid request" } }
```

| HTTP | Code                     | Cause                                        |
| ---- | ------------------------ | -------------------------------------------- |
| 400  | `INVALID_REQUEST`        | Request validation failed                    |
| 400  | `UNKNOWN_VOICE`          | Voice absent from the cached voice catalog   |
| 401  | `UNAUTHORIZED`           | Missing or invalid key                       |
| 404  | `NOT_FOUND`              | Route or asset not found                     |
| 429  | `RATE_LIMITED`           | Admission quota exceeded                     |
| 413  | `PAYLOAD_TOO_LARGE`      | Request body too large                       |
| 415  | `UNSUPPORTED_MEDIA_TYPE` | Unsupported Content-Type                     |
| 500  | `INTERNAL_ERROR`         | Internal error                               |
| 502  | `UPSTREAM_ERROR`         | Upstream connection or synthesis failed      |
| 503  | `SERVER_BUSY`            | Queue full or queue wait exceeded 30 seconds |

Both speech APIs share 12 requests/10 seconds per process. Voice discovery has a separate 60 requests/minute budget. See [configuration](configuration.md).
