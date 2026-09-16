# Deployment Guide

This guide covers self-hosted deployment options for `edgeTTS`, from standalone Docker Compose setups using pre-built images to bare-metal systemd services.

---

## Deployment Architectures

`edgeTTS` is designed to run behind a reverse proxy (such as Nginx or Caddy) on production hosts:

```text
Internet (Clients / Browsers / API Consumers)
                      │
                HTTPS (Port 443)
                      ▼
             Nginx / Caddy Reverse Proxy
                      │
             HTTP (127.0.0.1:8080)
                      ▼
             edgeTTS (Docker Container or Service)
```

- **Loopback Isolation**: The application binds to `127.0.0.1` on the host, preventing direct exposure to external public networks.
- **TLS Termination**: The reverse proxy terminates HTTPS, handles domain certificates, and forwards requests.
- **Streaming Buffering Rule**: Reverse proxies **must** disable response buffering (`proxy_buffering off;`) for speech synthesis routes so audio streams progressively to clients without latency.

---

## Prerequisites

- **Container Deployment**: Docker Engine 24.0+ and Docker Compose v2.
- **Bare-Metal Deployment**: Node.js 24 LTS and pnpm 12.3.4.
- **Network Egress**: Outbound HTTPS (TCP port 443) connectivity to Microsoft Edge TTS upstream endpoints.

---

## Method 1: Docker Compose with Pre-built Image (Recommended)

This is the fastest and most maintainable way to run edgeTTS in production. It requires no source code checkout and pulls multi-arch images directly from GitHub Container Registry (GHCR).

### 1. Create a Project Directory

```bash
mkdir -p ~/edgetts && cd ~/edgetts
```

### 2. Create `compose.yaml`

Create a `compose.yaml` file with the following configuration:

```yaml
services:
  edgetts:
    image: ghcr.io/dejavumoe/edgetts:0.4.0
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
      - SPEECH_RATE_LIMIT_MAX=12
      - SPEECH_RATE_LIMIT_WINDOW_MS=10000
```

> [!NOTE]
> To bind to a different local port, change `"127.0.0.1:8080:8080"` to `"127.0.0.1:<PORT>:8080"`. Keep `127.0.0.1:` to prevent exposing the port to public interfaces.

### 3. Generate Secret & Configure Environment

Generate a cryptographically secure random API key (minimum 16 characters):

```bash
echo "API_KEY=$(openssl rand -hex 32)" > .env
chmod 600 .env
```

### 4. Start the Service

```bash
docker compose up -d
```

### 5. Verify Health

```bash
curl -i http://127.0.0.1:8080/health
```

Expected output: `HTTP/1.1 200 OK` with body `{"status":"ok"}`.

### Container Management

```bash
# View container status
docker compose ps

# Follow application logs
docker compose logs -f

# Gracefully stop the service
docker compose stop

# Remove container
docker compose down
```

---

## Method 2: Single Container (`docker run`)

If you prefer running a single container directly with the Docker CLI:

### 1. Generate API Key

```bash
export API_KEY="$(openssl rand -hex 32)"
```

### 2. Run Container

```bash
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
  ghcr.io/dejavumoe/edgetts:0.4.0
```

### Security Flags Explained

| Flag                               | Purpose                                                                   |
| :--------------------------------- | :------------------------------------------------------------------------ |
| `-p 127.0.0.1:8080:8080`           | Binds container port 8080 strictly to the host loopback interface         |
| `--read-only`                      | Mounts the container root filesystem as read-only                         |
| `--cap-drop=ALL`                   | Drops all Linux capabilities to enforce least-privilege execution         |
| `--security-opt=no-new-privileges` | Prevents privilege escalation inside the container                        |
| `--tmpfs /tmp`                     | Mounts a memory-backed temporary filesystem for transient operations      |
| `--init`                           | Uses a lightweight init process (tini) to reap zombies and handle signals |
| `--stop-timeout 30`                | Allows 30 seconds for active synthesis streams to complete gracefully     |

---

## Image Tags & Digest Pinning

Official multi-architecture images support `linux/amd64` and `linux/arm64`.

| Image Tag                                   | Description                                 | Use Case                                  |
| :------------------------------------------ | :------------------------------------------ | :---------------------------------------- |
| `ghcr.io/dejavumoe/edgetts:0.4.0`           | Exact stable SemVer release                 | Production standard                       |
| `ghcr.io/dejavumoe/edgetts:latest`          | Tracks the highest published stable release | Automatic update environments             |
| `ghcr.io/dejavumoe/edgetts:main`            | Continuous snapshot built from `main`       | Testing latest fixes                      |
| `ghcr.io/dejavumoe/edgetts@sha256:<digest>` | Content-addressed immutable image           | Mission-critical reproducible deployments |

Each release records its verified multi-arch OCI index digest in the [GitHub Release Notes](https://github.com/DejavuMoe/edgeTTS/releases).

---

## Method 3: Build from Source with Docker Compose

To compile the container locally from the repository source code:

```bash
# 1. Clone repository
git clone https://github.com/DejavuMoe/edgeTTS.git
cd edgeTTS

# 2. Configure environment
cp .env.example .env

# 3. Generate a secure API key and insert into .env
sed -i "s/replace-with-a-random-secret/$(openssl rand -hex 32)/" .env

# 4. Build image and launch container
docker compose up -d --build
```

The repository `compose.yaml` uses `.env` variables for host port mapping:

- `EDGETTS_BIND_ADDRESS`: Host IP binding (default: `127.0.0.1`).
- `EDGETTS_HOST_PORT`: Host port mapping (default: `8080`).

---

## Method 4: Bare-Metal Installation (Node.js & Systemd)

For hosts running without container engines:

### 1. Install Node.js & pnpm

Ensure Node.js 24 LTS and pnpm 12.3.4 are installed:

```bash
node -v # v24.x
pnpm -v # 12.3.4
```

### 2. Clone and Build

```bash
git clone https://github.com/DejavuMoe/edgeTTS.git /opt/edgetts
cd /opt/edgetts

pnpm install --frozen-lockfile
pnpm build
```

### 3. Create System User

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin edgetts
sudo chown -R edgetts:edgetts /opt/edgetts
```

### 4. Configure Systemd Service

Create `/etc/systemd/system/edgetts.service`:

```ini
[Unit]
Description=edgeTTS Speech Synthesis Service
After=network.target

[Service]
Type=simple
User=edgetts
Group=edgetts
WorkingDirectory=/opt/edgetts
ExecStart=/usr/bin/node apps/server/dist/server.js
Restart=on-failure
RestartSec=5s

# Environment configuration
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=8080
Environment=REQUIRE_API_KEY=true
Environment=API_KEY=replace-with-your-generated-secret-key-at-least-16-chars

# Security sandbox
ProtectSystem=strict
ProtectHome=true
NoNewPrivileges=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictNamespaces=true
CapabilityBoundingSet=

[Install]
WantedBy=multi-user.target
```

### 5. Start and Enable Service

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now edgetts
sudo systemctl status edgetts
```

---

## Upgrades and Maintenance

### Upgrading Docker Compose Deployment

```bash
cd ~/edgetts

# Pull new image version specified in compose.yaml
docker compose pull

# Recreate container with zero data loss
docker compose up -d
```

### Clean Stale Images

```bash
docker image prune -f
```
