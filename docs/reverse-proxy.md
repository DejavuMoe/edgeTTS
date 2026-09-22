# Reverse Proxy Configuration Guide

This guide details how to configure production reverse proxies (Nginx, Caddy) in front of `edgeTTS`.

This example assumes the proxy runs on the host. Inside a proxy container, `127.0.0.1` refers to that proxy container: attach both services to a private Docker network and use `edgetts:8080` instead. The Nginx example assumes certificates already exist; obtain them before `nginx -t`. The deterministic proxy script requires Docker and may pull images even with upstream live checks disabled.

## Topology & Core Principles

```text
Clients (Browsers / Mobile Apps / OpenAI Clients)
                      │
                HTTPS (Port 443)
                      ▼
             Reverse Proxy (Nginx / Caddy)
                      │
             HTTP (127.0.0.1:8080)
                      ▼
             edgeTTS (Docker or Host Service)
```

1. **Loopback Isolation**: edgeTTS binds strictly to `127.0.0.1` on the host, preventing direct exposure to external public interfaces.
2. **TLS Termination**: The proxy manages public certificates and terminates HTTPS.
3. **Streaming**: Disable response buffering and caching for `/api/speech` and `/v1/audio/speech` to avoid delaying audio delivery.
4. **Headers**: Preserve `Authorization`. Set forwarding headers at the proxy; they do not provide authenticated client identities or per-client quotas.

## Nginx Configuration

Use the [canonical Nginx template](../deploy/nginx/edgetts.conf.example). Replace its domain and certificate paths before enabling it. Keep buffering and caching disabled for both speech routes.

### Installation Steps (Ubuntu / Debian)

```bash
# 1. Copy configuration
sudo cp deploy/nginx/edgetts.conf.example /etc/nginx/sites-available/edgetts.conf

# 2. Edit domain name and TLS certificate paths
sudo nano /etc/nginx/sites-available/edgetts.conf

# 3. Enable site
sudo ln -s /etc/nginx/sites-available/edgetts.conf /etc/nginx/sites-enabled/edgetts.conf

# 4. Test syntax
sudo nginx -t

# 5. Reload Nginx
sudo systemctl reload nginx
```

### Automated Proxy Test Suite

The repository includes an automated integration test script [`deploy/nginx/test-proxy.sh`](../deploy/nginx/test-proxy.sh). It validates configuration syntax, streaming delivery without buffering, error preservation, and header passthrough:

```bash
# Deterministic verification mode (no external network needed)
EDGETTS_NGINX_SKIP_LIVE=1 ./deploy/nginx/test-proxy.sh
```

## Caddy Configuration

Caddy provides automatic HTTPS with Let's Encrypt / ZeroSSL and simplified configuration.

### `Caddyfile` Example

```caddyfile
edgetts.example.com {
    encode zstd gzip

    # Streaming speech endpoints - disable response buffering
    @streaming {
        path /api/speech
        path /v1/audio/speech
    }
    handle @streaming {
        reverse_proxy 127.0.0.1:8080 {
            flush_interval -1
            transport http {
                dial_timeout 10s
                response_header_timeout 300s
            }
        }
    }

    # Default handler for WebUI, voices, and health
    handle {
        reverse_proxy 127.0.0.1:8080
    }
}
```

> [!TIP]
> Setting `flush_interval -1` forces Caddy to immediately flush every audio chunk to the client as soon as it is received from edgeTTS.

## Reverse Proxy Checklist

Before exposing the service publicly, verify:

1. **Streaming Playback**: Issue a synthesis request through the proxy. Verify that audio chunks arrive incrementally through the proxy. Startup time depends on the upstream service, queue and browser; no fixed latency is guaranteed.
2. **Bearer Token Preservation**: Ensure `Authorization: Bearer <API_KEY>` is passed through and returns 401 on incorrect keys.
3. **Error Status Codes**: Ensure application error JSON bodies (`400`, `401`, `429`, `502`, `503`) reach clients intact without proxy substitution.
4. **Health Check**: Ensure `GET /health` returns `200` with `{"status":"ok"}`.
