# Configuration Reference

This document details all configuration options, authentication behaviors, concurrency bounds, and security parameters in `edgeTTS`.

`REQUIRE_API_KEY` controls whether missing credentials prevent startup; it does not disable verification of a configured key. External authentication requires both `REQUIRE_API_KEY=false` and an unset `API_KEY`. Production defaults to requiring a key; local development remains optional. Node does not load `.env` automatically: use exported variables, `node --env-file=...`, or the systemd `EnvironmentFile`. Compose only forwards variables listed in its `environment` section.

The server validates every variable at startup and exits with a list of all invalid values. Unrecognized values are errors; they never fall back to a default silently. Unset variables use the defaults below.

## Environment Variables

### Application Server Configuration

These variables configure the Fastify application server (`apps/server`):

| Variable                      | Description                                | Valid Values                                                              | Default                                            |
| :---------------------------- | :----------------------------------------- | :------------------------------------------------------------------------ | :------------------------------------------------- |
| `HOST`                        | IP address for HTTP server binding         | Valid IPv4 / IPv6 address                                                 | `127.0.0.1` (bare Node)<br>`0.0.0.0` (Docker)      |
| `PORT`                        | Listening port for HTTP traffic            | `1`–`65535`                                                               | `8080`                                             |
| `NODE_ENV`                    | Runtime environment mode                   | `production`, `development`, `test`                                       | `production` (Docker)                              |
| `API_KEY`                     | Secret token for Bearer authentication     | String (>= 16 chars, no whitespace)                                       | None                                               |
| `REQUIRE_API_KEY`             | Require a key at startup                   | `true` or `false`                                                         | `true` in production / Compose; otherwise `false`  |
| `SPEECH_RATE_LIMIT_MAX`       | Max speech requests allowed per window     | Integer (`1`–`10000`)                                                     | `12`                                               |
| `SPEECH_RATE_LIMIT_WINDOW_MS` | Rate limit window duration in milliseconds | Integer (`100`–`3600000`)                                                 | `10000` (10 seconds)                               |
| `SPEECH_RATE_LIMIT_SCOPE`     | Who shares the speech budget               | `global` or `ip`                                                          | `global`                                           |
| `SERVE_STATIC`                | Enable Fastify static web asset hosting    | `true` or `false`                                                         | Enabled in `production`                            |
| `WEB_DIST_DIR`                | Filesystem path to compiled web UI bundle  | Absolute or relative directory path                                       | `/app/web-dist` (Docker)<br>`apps/web/dist` (Node) |
| `TRUST_PROXY`                 | Reverse proxies trusted for client address | `false`, `true`, hop count (`1`–`16`), or comma-separated addresses/CIDRs | `false`                                            |
| `METRICS_ENABLED`             | Serve Prometheus metrics at `/api/metrics` | `true` or `false`                                                         | `false`                                            |

### Capacity & Timeout Tuning

The defaults suit a single self-hosted instance. Change them only after measuring real load.

| Variable                     | Description                                     | Valid Values                  | Default              |
| :--------------------------- | :---------------------------------------------- | :---------------------------- | :------------------- |
| `SYNTHESIS_MAX_CONCURRENT`   | Active synthesis streams per process            | Integer (`1`–`64`)            | `4`                  |
| `SYNTHESIS_MAX_QUEUED`       | FIFO waiters before returning `503 SERVER_BUSY` | Integer (`0`–`1024`)          | `16`                 |
| `VOICE_CACHE_TTL_MS`         | Voice list cache lifetime in milliseconds       | Integer (`60000`–`604800000`) | `21600000` (6 hours) |
| `EDGE_VOICES_TIMEOUT_MS`     | Upstream voice discovery timeout                | Integer (`1000`–`600000`)     | `10000` (10 seconds) |
| `EDGE_SETUP_TIMEOUT_MS`      | Upstream synthesis setup timeout                | Integer (`1000`–`600000`)     | `10000` (10 seconds) |
| `EDGE_AUDIO_IDLE_TIMEOUT_MS` | Longest wait for the next upstream audio chunk  | Integer (`1000`–`600000`)     | `120000` (2 minutes) |

To set any of these with Compose, add them to the service's `environment` section.

### Docker Compose Host Variables (`.env`)

These variables configure host-side container port binding in `compose.yaml`:

| Variable               | Description                                   | Default     |
| :--------------------- | :-------------------------------------------- | :---------- |
| `EDGETTS_BIND_ADDRESS` | Host IP address for container port forwarding | `127.0.0.1` |
| `EDGETTS_HOST_PORT`    | Host port mapped to container port 8080       | `8080`      |

## Authentication & Security

### Bearer Token Specification

Whenever `API_KEY` is configured, protected endpoints require the API key to be passed via the HTTP `Authorization` header:

```http
Authorization: Bearer <API_KEY>
```

- **Protected Routes**: `GET /api/voices`, `POST /api/speech`, `POST /v1/audio/speech`.
- **Public Routes**: `GET /health`, `GET /api/health`, and static Workbench assets (`GET /`).

1. **No Query Parameter Tokens**: edgeTTS intentionally does **not** accept API keys in query parameters (such as `?api_key=` or `?token=`). Query parameters are frequently logged in plain text by reverse proxies, browser histories, and server access logs.
2. **Constant-Time Verification**: Key comparison uses `crypto.timingSafeEqual` over cryptographic hashes to prevent timing side-channel attacks.
3. **Minimum Length**: Keys must contain at least 16 non-whitespace characters.
4. **Transient Browser Memory**: When using the Web Workbench, the API key is retained strictly in volatile React state. It is never written to `localStorage`, `sessionStorage`, cookies, or the page URL.

## Concurrency Limiting & Queue Management

By default each process permits four active streams (`SYNTHESIS_MAX_CONCURRENT`) and sixteen FIFO waiters (`SYNTHESIS_MAX_QUEUED`). A full queue returns `503 SERVER_BUSY`.

edgeTTS enforces strict in-memory concurrency controls via `TtsService`:

- **Fair Concurrency Allocation**: Long-text segmented requests hold exactly one concurrency permit for their entire sequential streaming lifecycle. This prevents mid-stream queue starvation and maintains audio continuity.
- **Client Disconnect Cancellation**: If a client closes its connection or aborts the HTTP request, edgeTTS terminates the upstream Microsoft WebSocket session immediately and releases the concurrency permit.
- **Upstream Connection Reuse**: All segments of one request share a single upstream connection, saving a handshake per segment. If the service closes it between segments, edgeTTS reconnects within the setup timeout. See [long-text performance](../development/research/performance.zh-CN.md).

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

Queued synthesis requests wait at most **30 seconds**, then return `503 SERVER_BUSY`; the deadline does not limit an admitted audio stream. By default the provider allows 10 seconds for setup (`EDGE_SETUP_TIMEOUT_MS`) and 120 seconds without audio data (`EDGE_AUDIO_IDLE_TIMEOUT_MS`). These limits do not guarantee a total synthesis duration.

By default speech limits are global per process, shared by both endpoints and all callers. With `SPEECH_RATE_LIMIT_SCOPE=ip`, each client address gets its own budget, still shared by both endpoints. Behind a reverse proxy this needs `TRUST_PROXY`; otherwise every client appears as the proxy and shares one budget. Address-based limits curb accidental overload, not a determined client that can change address. This single-key service does not provide tenant isolation. For independently trusted clients, apply per-client authentication and quotas at a trusted gateway; do not use an untrusted forwarded IP as identity. Voice discovery has a separate **60 requests/minute per process** limit, after authentication. Health probes remain public and outside these quotas.

## Request Size

Request bodies are limited to 256 KiB and larger bodies return `413 PAYLOAD_TOO_LARGE`. This fits the largest valid native request: 20,000 code points, even when every code point is JSON-escaped as a surrogate pair.

## Trusted Proxies

By default edgeTTS ignores `X-Forwarded-*` headers, so logs record the proxy's address as the client. Set `TRUST_PROXY` to the proxy's own address to record the forwarded client address and protocol instead:

- `loopback`: a proxy on the same host in front of a bare Node process.
- The Docker network gateway address or CIDR: a host proxy in front of the container, because the container sees the gateway as the peer.
- A hop count trusts that many proxies. `true` trusts every peer; use it only when the proxy is the sole network path to edgeTTS, because any other client can forge `X-Forwarded-For`.

`TRUST_PROXY` affects request metadata, logs and, with `SPEECH_RATE_LIMIT_SCOPE=ip`, the address used for speech limits.

## Metrics

With `METRICS_ENABLED=true`, `GET /api/metrics` serves the Prometheus text format behind the same API key as the other protected routes. Labels contain route templates and fixed reasons only, never URLs, voices or request text. Counters reset when the process restarts. A failure after audio has started streaming does not change the recorded status.

| Metric                                                        | Type    | Meaning                                                     |
| :------------------------------------------------------------ | :------ | :---------------------------------------------------------- |
| `edgetts_http_responses_total{method,route,status}`           | counter | HTTP responses by route template                            |
| `edgetts_synthesis_active`                                    | gauge   | Sessions holding a concurrency permit                       |
| `edgetts_synthesis_queued`                                    | gauge   | Requests waiting for a permit                               |
| `edgetts_synthesis_rejected_total{reason}`                    | counter | `queue_full`, `queue_timeout` or `unknown_voice`            |
| `edgetts_voice_catalog_voices`                                | gauge   | Cached voices; `0` before the first fetch                   |
| `edgetts_voice_catalog_age_seconds`                           | gauge   | Age of the cached voice list; absent before the first fetch |
| `process_resident_memory_bytes`, `process_start_time_seconds` | gauge   | Process memory and start time                               |

## Voice Metadata Caching

- `GET /api/voices` caches voice lists in server memory with a **6-hour TTL** by default (`VOICE_CACHE_TTL_MS`).
- Voice discovery starts lazily on the first request and concurrent fetches share one promise.
- On a refresh failure, a previously cached list remains available with a fixed 5-second retry backoff. A cold cache has no stale fallback or backoff.
- Upstream discovery has a 10-second logical timeout by default (`EDGE_VOICES_TIMEOUT_MS`); the dependency cannot cancel its underlying HTTP request.

A stale list has no separate maximum age.

While a cached list is within its TTL, speech requests for a voice absent from it return `400 UNKNOWN_VOICE` before using capacity. Matching ignores case. Synthesis never fetches the list: with a cold or expired cache, requests proceed and the upstream service decides.

## Container Security Hardening

The image runs as `node`. The recommended Compose / `docker run` options add a read-only root, `cap_drop=ALL`, `no-new-privileges`, a `/tmp` tmpfs, and Docker’s injected init process (`init: true` / `--init`). These runtime restrictions are not embedded in the image.

The server sends `nosniff`, a referrer policy, a camera/microphone/geolocation restriction, and CSP. CSP allows same-origin scripts, inline styles used by the controls, and `blob:` audio; it blocks inline scripts and framing from other origins. HTTPS termination remains the reverse proxy’s responsibility.
