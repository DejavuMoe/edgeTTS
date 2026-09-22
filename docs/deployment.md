# Deployment Guide

This guide covers self-hosted deployment options for `edgeTTS`, from standalone Docker Compose setups using pre-built images to bare-metal systemd services.

`/health` checks the HTTP process only; it does not contact Microsoft or prove synthesis works. For a remote server, use its HTTPS reverse-proxy URL to open the workbench and enter the same key. The Compose `.env` file is not automatically exported to your shell: before the API examples, run `set -a; . ./.env; set +a` for this locally generated file. Do not regenerate `.env` when restarting or upgrading.

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

## Prerequisites

- **Container Deployment**: Docker Engine 24.0+ and Docker Compose v2.
- **Bare-Metal Deployment**: Node.js 24 LTS and pnpm 12.3.4.
- **Network Egress**: Outbound HTTPS (TCP port 443) connectivity to Microsoft Edge TTS upstream endpoints.

## Method 1: Docker Compose with Pre-built Image (Recommended)

See [README](../README.md) for the Compose configuration and first start.

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
  --stop-timeout 35 \
  -p 127.0.0.1:8080:8080 \
  -e API_KEY="$API_KEY" \
  -e REQUIRE_API_KEY=true \
  ghcr.io/dejavumoe/edgetts:0.5.0
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
| `--stop-timeout 35`                | Allows 30 seconds for active synthesis streams to complete gracefully     |

## Image Tags & Digest Pinning

Official multi-architecture images support `linux/amd64` and `linux/arm64`.

| Image Tag                                   | Description                                 | Use Case                                  |
| :------------------------------------------ | :------------------------------------------ | :---------------------------------------- |
| `ghcr.io/dejavumoe/edgetts:0.5.0`           | Exact stable SemVer release                 | Production standard                       |
| `ghcr.io/dejavumoe/edgetts:latest`          | Tracks the highest published stable release | Automatic update environments             |
| `ghcr.io/dejavumoe/edgetts:main`            | Continuous snapshot built from `main`       | Testing latest fixes                      |
| `ghcr.io/dejavumoe/edgetts@sha256:<digest>` | Content-addressed immutable image           | Mission-critical reproducible deployments |

Each release records its verified multi-arch OCI index digest in the [GitHub Release Notes](https://github.com/DejavuMoe/edgeTTS/releases).

## Method 3: Build from Source with Docker Compose

To compile the container locally from the repository source code:

```bash
# 1. Clone repository
git clone https://github.com/DejavuMoe/edgeTTS.git
cd edgeTTS

# 2. Configure environment
cp .env.example .env
chmod 600 .env

# 3. Generate a secure API key and insert into .env
sed -i "s/^# API_KEY=.*/API_KEY=$(openssl rand -hex 32)/" .env

# 4. Build image and launch container
docker compose up -d --build
```

The repository `compose.yaml` uses `.env` variables for host port mapping:

- `EDGETTS_BIND_ADDRESS`: Host IP binding (default: `127.0.0.1`).
- `EDGETTS_HOST_PORT`: Host port mapping (default: `8080`).

## Method 4: Bare-Metal Installation (Node.js & Systemd)

Run the `/opt` installation steps as root (or with appropriate `sudo` permissions). Verify `command -v node`; update `ExecStart` if Node is not installed at `/usr/bin/node`. Keep the application tree root-owned; only the service runs as `edgetts`. The root-readable `/etc/edgetts.env` keeps the key out of the public unit file. Generate it once and retain it on upgrades.

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
sudo chown -R root:root /opt/edgetts
sudo sh -c 'umask 077; set -C; printf "API_KEY=%s\n" "$(openssl rand -hex 32)" > /etc/edgetts.env'
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
TimeoutStopSec=35s

# Environment configuration
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=8080
Environment=REQUIRE_API_KEY=true
EnvironmentFile=/etc/edgetts.env

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

## Upgrades and Maintenance

First change `image:` in `compose.yaml` to the desired published version or digest. `docker compose pull` only pulls the configured reference; it does not advance a pinned `0.5.0` to another version. Keep `.env` and the previous image reference.

```bash
cd ~/edgetts
docker compose pull edgetts
docker compose up -d edgetts
curl --fail http://127.0.0.1:8080/health
```

To roll back, restore the previous image reference and repeat these commands. Source builds instead require checking out the desired revision and running `docker compose up -d --build`. A single instance briefly stops accepting requests during replacement; active streams may be interrupted after the 30-second server drain deadline. Do not promise uninterrupted or millisecond upgrades.
