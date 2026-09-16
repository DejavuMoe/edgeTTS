# Configuration Reference

This document details all configuration options, authentication behaviors, concurrency bounds, and security parameters in `edgeTTS`.

`REQUIRE_API_KEY` controls whether missing credentials prevent startup; it does not disable verification of a configured key. External authentication requires both `REQUIRE_API_KEY=false` and an unset `API_KEY`. Production defaults to requiring a key; local development remains optional. Node does not load `.env` automatically: use exported variables, `node --env-file=...`, or the systemd `EnvironmentFile`. Compose only forwards variables listed in its `environment` section.

---

## Environment Variables

### Application Server Configuration

These variables configure the Fastify application server (`apps/server`):

| Variable                      | Description                                | Valid Values                        | Default                                            |
| :---------------------------- | :----------------------------------------- | :---------------------------------- | :------------------------------------------------- |
| `HOST`                        | IP address for HTTP server binding         | Valid IPv4 / IPv6 address           | `127.0.0.1` (bare Node)<br>`0.0.0.0` (Docker)      |
| `PORT`                        | Listening port for HTTP traffic            | `1`–`65535`                         | `8080`                                             |
| `NODE_ENV`                    | Runtime environment mode                   | `production`, `development`, `test` | `production` (Docker)                              |
| `API_KEY`                     | Secret token for Bearer authentication     | String (>= 16 chars, no whitespace) | None                                               |
| `REQUIRE_API_KEY`             | Require a key at startup                   | `true` or `false`                   | `true` in production / Compose; otherwise `false`  |
| `SPEECH_RATE_LIMIT_MAX`       | Max speech requests allowed per window     | Integer (`1`–`10000`)               | `12`                                               |
| `SPEECH_RATE_LIMIT_WINDOW_MS` | Rate limit window duration in milliseconds | Integer (`100`–`3600000`)           | `10000` (10 seconds)                               |
| `SERVE_STATIC`                | Enable Fastify static web asset hosting    | `true` or `false`                   | Enabled in `production`                            |
| `WEB_DIST_DIR`                | Filesystem path to compiled web UI bundle  | Absolute or relative directory path | `/app/web-dist` (Docker)<br>`apps/web/dist` (Node) |

### Docker Compose Host Variables (`.env`)

These variables configure host-side container port binding in `compose.yaml`:

| Variable               | Description                                   | Default     |
| :--------------------- | :-------------------------------------------- | :---------- |
| `EDGETTS_BIND_ADDRESS` | Host IP address for container port forwarding | `127.0.0.1` |
| `EDGETTS_HOST_PORT`    | Host port mapped to container port 8080       | `8080`      |

---

## Authentication & Security

### Bearer Token Specification

Whenever `API_KEY` is configured, protected endpoints require the API key to be passed via the HTTP `Authorization` header:

```http
Authorization: Bearer <API_KEY>
```

- **Protected Routes**: `GET /api/voices`, `POST /api/speech`, `POST /v1/audio/speech`.
- **Public Routes**: `GET /health`, `GET /api/health`, and static Workbench assets (`GET /`).

### Security Architecture

1. **No Query Parameter Tokens**: edgeTTS intentionally does **not** accept API keys in query parameters (such as `?api_key=` or `?token=`). Query parameters are frequently logged in plain text by reverse proxies, browser histories, and server access logs.
2. **Constant-Time Verification**: Key comparison uses `crypto.timingSafeEqual` over cryptographic hashes to prevent timing side-channel attacks.
3. **Minimum Length**: Keys must contain at least 16 non-whitespace characters.
4. **Transient Browser Memory**: When using the Web Workbench, the API key is retained strictly in volatile React state. It is never written to `localStorage`, `sessionStorage`, cookies, or the page URL.

---

## Concurrency Limiting & Queue Management

edgeTTS enforces strict in-memory concurrency controls via `TtsService`:

```text
Incoming Request
      │
      ▼
Admission Rate Limiter (12 req / 10s per process)
      │
      ▼
TtsService Concurrency Limiter
      │
      ├─ Active Streams < 4  ──► Synthesizing upstream
      │
      ├─ Active Streams = 4  ──► Queued in FIFO slot (up to 16)
      │
      └─ Queue Full (16)     ──► 503 Service Unavailable (SERVER_BUSY)
```

- **Fair Concurrency Allocation**: Long-text segmented requests hold exactly one concurrency permit for their entire sequential streaming lifecycle. This prevents mid-stream queue starvation and maintains audio continuity.
- **Client Disconnect Cancellation**: If a client closes its connection or aborts the HTTP request, edgeTTS terminates the upstream Microsoft WebSocket session immediately and releases the concurrency permit.

---

## Admission Rate Limiting

A windowed rate limiter protects synthesis routes (`/api/speech` and `/v1/audio/speech`):

- **Default Limits**: 12 requests per 10-second fixed window per server process.
- **Response Headers**:
  - `X-RateLimit-Limit`: Maximum requests per window.
  - `X-RateLimit-Remaining`: Remaining request allowance in the current window.
  - `X-RateLimit-Reset`: Seconds until the quota resets.
- **Rate Limit Exceeded**: Returns HTTP 429 with JSON body:
  ```json
  {
    "error": {
      "code": "RATE_LIMITED",
      "message": "Too many speech requests"
    }
  }
  ```

---

Queued synthesis requests wait at most **30 seconds**, then return `503 SERVER_BUSY`; the deadline does not limit an admitted audio stream. The provider allows 10 seconds for setup and 120 seconds without audio data. These limits do not guarantee a total synthesis duration.

Speech limits are global per process, shared by both endpoints and all callers. This single-key service does not provide tenant isolation. For independently trusted clients, apply per-client authentication and quotas at a trusted gateway; do not use an untrusted forwarded IP as identity. Voice discovery has a separate **60 requests/minute per process** limit, after authentication. Health probes remain public and outside these quotas.

---

## Voice Metadata Caching

- `GET /api/voices` caches voice lists in server memory with a **6-hour TTL**.
- Voice discovery starts lazily on the first request and concurrent fetches share one promise.
- On a refresh failure, a previously cached list remains available with a fixed 5-second retry backoff. A cold cache has no stale fallback or backoff.
- Upstream discovery has a 10-second logical timeout; the dependency cannot cancel its underlying HTTP request.

---

## Container Security Hardening

The image runs as `node`. The recommended Compose / `docker run` options add a read-only root, `cap_drop=ALL`, `no-new-privileges`, a `/tmp` tmpfs, and Docker’s injected init process (`init: true` / `--init`). These runtime restrictions are not embedded in the image.

The server sends `nosniff`, a referrer policy, a camera/microphone/geolocation restriction, and CSP. CSP allows same-origin scripts, inline styles used by the controls, and `blob:` audio; it blocks inline scripts and framing from other origins. HTTPS termination remains the reverse proxy’s responsibility.
