# Nginx Production Reverse Proxy Deployment Guide

This guide describes how to deploy an Nginx reverse proxy in front of the EdgeTTS containerized service on a production host.

## Architecture

```text
Internet (Clients / Browsers / OpenAI Clients)
                     │
              HTTPS (Port 443)
                     ▼
           Nginx Reverse Proxy
                     │
           HTTP/1.1 (127.0.0.1:8080)
                     ▼
       EdgeTTS Docker Container (Compose)
```

- **Loopback isolation**: EdgeTTS binds strictly to `127.0.0.1:8080` on the host, preventing direct exposure to external public interfaces.
- **TLS termination**: Nginx terminates public HTTPS traffic and redirects port 80 HTTP traffic to HTTPS.
- **Header preservation**: Client headers (`Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`, and `Authorization`) are forwarded to EdgeTTS.
- **Streaming optimization**: Response buffering is disabled (`proxy_buffering off;`) exclusively on streaming speech endpoints (`/api/speech` and `/v1/audio/speech`) so audio chunks reach clients without delay.

## Deployment Steps

### 1. Ensure EdgeTTS Container is Running on Loopback

The default `compose.yaml` and `.env.example` bind EdgeTTS to `127.0.0.1:8080`. Verify that EdgeTTS is healthy:

```bash
curl -i http://127.0.0.1:8080/health
```

Expected response: `HTTP/1.1 200 OK` with `{"status":"ok"}`.

### 2. Copy the Nginx Configuration Template

Copy `edgetts.conf.example` to your host Nginx configuration directory:

```bash
# Debian / Ubuntu (sites-available style)
sudo cp deploy/nginx/edgetts.conf.example /etc/nginx/sites-available/edgetts.conf
sudo ln -s /etc/nginx/sites-available/edgetts.conf /etc/nginx/sites-enabled/edgetts.conf

# Or RedHat / AlmaLinux / Alpine (conf.d style)
sudo cp deploy/nginx/edgetts.conf.example /etc/nginx/conf.d/edgetts.conf
```

### 3. Configure Domain and TLS Certificates

Edit the configuration file:

1. Replace `edgetts.example.com` with your actual domain name in both `server` blocks.
2. Replace `/path/to/fullchain.pem` and `/path/to/privkey.pem` with the absolute paths to your valid TLS certificate and private key (e.g. from Let's Encrypt / Certbot or your organizational CA).

> [!NOTE]
> EdgeTTS does not manage TLS certificates or run ACME/Certbot clients. Certificate issuance and renewal remain the host administrator's responsibility.

### 4. Validate Configuration Syntax

Always test the Nginx configuration before reloading:

```bash
sudo nginx -t
```

Ensure the output reports syntax is ok and the test is successful.

### 5. Reload Nginx

Apply the configuration by reloading Nginx without interrupting active connections:

```bash
sudo systemctl reload nginx
# Or:
sudo nginx -s reload
```

## Key Configuration Details

### Response Buffering on Speech Endpoints

EdgeTTS streams audio chunks progressively as Microsoft Edge TTS synthesizes speech. If Nginx buffers responses, audio delivery will be withheld until a large buffer fills or the stream finishes.

In `edgetts.conf.example`:

- `location = /api/speech` and `location = /v1/audio/speech` specify:
  ```nginx
  proxy_buffering off;
  proxy_cache off;
  proxy_read_timeout 300s;
  proxy_send_timeout 60s;
  ```
  This guarantees immediate first-chunk streaming playback in client players.
- All other endpoints (`location /`) retain default buffering for optimal web asset delivery and API throughput.

### Authentication & Header Passthrough

- **No Hardcoded Keys**: The Nginx configuration does **not** define an `API_KEY` or `auth_basic`.
- **Bearer Passthrough**: Nginx natively preserves incoming `Authorization: Bearer <token>` headers so EdgeTTS performs constant-time validation inside the application.
- **Unmodified Error Responses**: `proxy_intercept_errors` is omitted so application error JSON bodies (400, 401, 502, 503) and the `WWW-Authenticate: Bearer realm="edgeTTS"` challenge header pass unaltered directly to clients.

## Automated Integration Testing

An automated verification script is provided in [`test-proxy.sh`](test-proxy.sh). It mechanically derives its test configurations directly from `edgetts.conf.example` without maintaining duplicate proxy definitions, spins up ephemeral Nginx and EdgeTTS containers in Docker, and validates:

1. `nginx -t` configuration syntax using a pinned container (`nginx:1.27.4-alpine-slim`).
2. Immediate first-chunk delivery on `/api/speech` and `/v1/audio/speech` with response buffering disabled over HTTPS.
3. HTTP 400 and 503 error status code, header, and JSON body preservation.
4. HTTPS TLS termination and client Bearer authentication passthrough.
5. End-to-end real speech synthesis through the proxy.

### Prerequisites

The integration test script requires the following host tools:

- `docker` (with permissions to run containers)
- `curl` (for issuing HTTP/HTTPS test requests)
- `openssl` (for generating ephemeral self-signed test certificates)
- `jq` (for parsing JSON responses)
- `awk` (for static configuration auditing)
- `sed` (for template transformation)

### Running the Test Suite

```bash
# Run with local EdgeTTS image
EDGETTS_TEST_IMAGE=edgetts:local ./deploy/nginx/test-proxy.sh

# Optional: configure custom test port (default: 18082)
EDGETTS_NGINX_TEST_PORT=18085 ./deploy/nginx/test-proxy.sh
```
