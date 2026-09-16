# Configuration Reference

This document details all configuration options, authentication behaviors, concurrency bounds, and security parameters in `edgeTTS`.

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
| `REQUIRE_API_KEY`             | Enforce API key verification               | `true` or `false`                   | `false` (bare Node)<br>`true` (Docker Compose)     |
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

When `REQUIRE_API_KEY=true`, protected endpoints require the API key to be passed via the HTTP `Authorization` header:

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

- **Default Limits**: 12 requests per 10-second sliding window per server process.
- **Response Headers**:
  - `X-RateLimit-Limit`: Maximum requests per window.
  - `X-RateLimit-Remaining`: Remaining request allowance in the current window.
  - `X-RateLimit-Reset`: Seconds until the quota resets.
- **Rate Limit Exceeded**: Returns HTTP 429 with JSON body:
  ```json
  {
    "error": {
      "code": "RATE_LIMITED",
      "message": "Too many speech requests, please try again later"
    }
  }
  ```

---

## Voice Metadata Caching

- `GET /api/voices` caches voice lists in server memory with a **6-hour TTL**.
- If an upstream discovery error occurs, an exponential backoff of 5 seconds is applied before retrying.
- The voice cache is initialized lazily upon the first request or pre-warmed.

---

## Container Security Hardening

The official production Docker image is built to strict security standards:

- **Unprivileged User**: Runs as user `node` (`UID 1000`, `GID 1000`).
- **Read-Only Root**: The entire root filesystem is mounted read-only (`--read-only`).
- **Zero Capabilities**: All Linux kernel capabilities are stripped (`--cap-drop=ALL`).
- **No Privilege Escalation**: Enforced via `no-new-privileges:true`.
- **Ephemeral Scratch Storage**: Mounted strictly on `/tmp` as a `tmpfs` volume.
- **Zombie Process Reaping**: Uses `tini` (`--init`) as PID 1 to ensure signals and child processes are reaped properly.
- **Graceful Drain Timeout**: Configured with a 30-second stop timeout (`stop_grace_period: 30s`) to allow active audio streams to complete during container restarts.
