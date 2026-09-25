# 自托管部署指南

本文档介绍 `edgeTTS` 的多种自托管部署方案，包括使用 GHCR 预构建镜像的独立 Docker Compose 部署、Docker 单容器运行、源码编译部署以及 Linux systemd 原生服务运行。

`/health` 只检查 HTTP 进程，不访问微软，也不证明合成可用。部署在远程服务器时，通过反向代理的 HTTPS 地址打开工作台，并输入同一个密钥。Compose 的 `.env` 不会自动导入当前 shell；执行 API 示例前，对本地生成的文件运行 `set -a; . ./.env; set +a`。重启或升级时不要重新生成 `.env`。

## 部署架构与安全原则

在生产环境中，`edgeTTS` 建议部署在反向代理（如 Nginx 或 Caddy）之后：

```text
公网客户端 (浏览器 / 移动端 / API 调用者)
                    │
              HTTPS (443 端口)
                    ▼
           Nginx / Caddy 反向代理
                    │
           HTTP (127.0.0.1:8080)
                    ▼
           edgeTTS 容器或后台服务
```

- **本地回环隔离（127.0.0.1）**：服务默认监听本机回环地址，避免将未加密或未受防护的内部端口直接暴露在公网。
- **TLS 证书终结**：反向代理统一负责 HTTPS 证书管理与自动续期。
- **流式无缓冲原则**：反向代理针对语音合成接口（`/api/speech` 与 `/v1/audio/speech`）**必须**关闭响应缓冲（`proxy_buffering off;`），确保音频分片能够实时流式推送到客户端播放器。

## 环境准备

- **容器化部署**：Docker Engine 24.0+ 与 Docker Compose v2。
- **源码与裸机部署**：Node.js 24 LTS 与 pnpm 12.3.4。
- **出站网络**：宿主机必须具备访问微软 Edge TTS 官方节点的出站 HTTPS（TCP 443 端口）网络权限。

## 方案一：Docker Compose 预构建镜像部署（推荐）

直接运行已发布的多架构镜像，无需克隆或编译源码。在一个空目录（例如 `~/edgetts`）中创建 `compose.yaml`：

```yaml
services:
  edgetts:
    image: ghcr.io/dejavumoe/edgetts:0.7.0
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
    stop_grace_period: 35s
    ports:
      - "${EDGETTS_BIND_ADDRESS:-127.0.0.1}:${EDGETTS_HOST_PORT:-8080}:8080"
    environment:
      - NODE_ENV=production
      - HOST=0.0.0.0
      - PORT=8080
      - API_KEY
      - REQUIRE_API_KEY=${REQUIRE_API_KEY:-true}
      - SPEECH_RATE_LIMIT_MAX
      - SPEECH_RATE_LIMIT_WINDOW_MS
```

然后只需创建一次 `.env` 并启动服务：

```bash
# 1. 进入 compose.yaml 所在目录
mkdir -p ~/edgetts && cd ~/edgetts

# 2. 生成随机 API Key；文件仅当前用户可读，且不会覆盖已有文件
(umask 077; set -C; printf 'API_KEY=%s\n' "$(openssl rand -hex 32)" > .env)

# 3. 拉取已发布镜像、启动并检查进程
docker compose pull
docker compose up -d
curl --fail http://127.0.0.1:8080/health
```

升级时保留 `.env`。`REQUIRE_API_KEY` 默认为 `true`，缺少 `API_KEY` 时容器会拒绝启动。同一个 `.env` 还可以设置宿主机绑定用的 `EDGETTS_BIND_ADDRESS` 与 `EDGETTS_HOST_PORT`（默认 `127.0.0.1:8080`），以及 `SPEECH_RATE_LIMIT_MAX`、`SPEECH_RATE_LIMIT_WINDOW_MS`。Compose 只转发 `environment` 中列出的变量：如需使用[配置参考](configuration.zh-CN.md)中的其他变量（例如 `TRUST_PROXY`、`METRICS_ENABLED`），先把它们加入该列表，再写入 `.env`。需要可复现部署时，可将标签替换为发布说明中的摘要（见下文）。

## 方案二：Docker 单容器运行 (`docker run`)

如果习惯使用原生 Docker 命令直接启动：

### 1. 生成 API Key

```bash
export API_KEY="$(openssl rand -hex 32)"
```

### 2. 启动容器

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
  ghcr.io/dejavumoe/edgetts:0.7.0
```

### 安全参数说明

| 参数                               | 说明                                                       |
| :--------------------------------- | :--------------------------------------------------------- |
| `-p 127.0.0.1:8080:8080`           | 将容器 8080 端口严格绑定至宿主机 127.0.0.1 回环接口        |
| `--read-only`                      | 将容器根文件系统挂载为只读，防止文件意外或恶意篡改         |
| `--cap-drop=ALL`                   | 移除全部 Linux 内核 Capabilities，执行最小特权原则         |
| `--security-opt=no-new-privileges` | 禁止容器内进程获取更高权限（禁用 setuid/setgid 提权）      |
| `--tmpfs /tmp`                     | 仅挂载内存临时目录 `/tmp` 供应用写入临时数据               |
| `--init`                           | 启用轻量级 init 进程（tini）回收僵尸进程并可靠转发信号     |
| `--stop-timeout 35`                | 给予容器 35 秒停止时间，包含服务端 30 秒等待期限与退出余量 |

## 容器镜像标签与摘要

官方多架构镜像同时原生支持 `linux/amd64` 与 `linux/arm64`（Apple Silicon、树莓派等）。

| 镜像标签                                    | 描述                               | 适用场景                 |
| :------------------------------------------ | :--------------------------------- | :----------------------- |
| `ghcr.io/dejavumoe/edgetts:0.7.0`           | 严格语义化版本发布标签             | 生产环境常规部署         |
| `ghcr.io/dejavumoe/edgetts:latest`          | 始终指向最新稳定发布版本           | 自动化环境跟踪           |
| `ghcr.io/dejavumoe/edgetts:main`            | 跟踪 `main` 分支最新构建的代码快照 | 测试最新特性或缺陷修复   |
| `ghcr.io/dejavumoe/edgetts@sha256:<digest>` | 基于内容寻址的不可变镜像摘要       | 严格可复现的生产基线锁定 |

每个稳定发布版本的已验证 OCI 索引摘要均记录在对应的 [GitHub Release 说明](https://github.com/DejavuMoe/edgeTTS/releases) 中。

## 方案三：源码编译与 Docker Compose 部署（开发）

仓库自带的 `compose.yaml` 会从当前工作区源码构建 `edgetts:local` 镜像，而不是拉取已发布镜像。适合开发和测试源码改动；生产部署建议使用方案一。

```bash
# 1. 克隆代码仓库
git clone https://github.com/DejavuMoe/edgeTTS.git
cd edgeTTS

# 2. 初始化环境配置
cp .env.example .env
chmod 600 .env

# 3. 生成随机 API Key 并填入 .env
sed -i "s/^# API_KEY=.*/API_KEY=$(openssl rand -hex 32)/" .env

# 4. 构建本地镜像并启动
docker compose up -d --build
```

仓库根目录下的 `compose.yaml` 读取 `.env` 中的以下变量：

- `EDGETTS_BIND_ADDRESS`：宿主机绑定地址（默认 `127.0.0.1`）。
- `EDGETTS_HOST_PORT`：宿主机映射端口（默认 `8080`）。

修改源码后，重新构建镜像并替换容器：

```bash
docker compose build
docker compose up -d
```

也可以用 `docker compose up -d --build` 一步完成。

## 方案四：Linux 原生服务部署（Node.js + Systemd）

安装到 `/opt` 的步骤需以 root 或相应 sudo 权限执行。先用 `command -v node` 确认路径；若不是 `/usr/bin/node`，修改 `ExecStart`。程序目录由 root 持有，仅服务进程使用 `edgetts` 用户。密钥放入仅 root 可读的 `/etc/edgetts.env`，不写入公开的服务单元；只在首次安装时生成，升级时保留。

适用于不具备容器环境的纯 Linux 服务器：

### 1. 环境准备

确保已安装 Node.js 24 LTS 与 pnpm 12.3.4：

```bash
node -v # 应为 v24.x
pnpm -v # 应为 12.3.4
```

### 2. 获取代码并构建

```bash
git clone https://github.com/DejavuMoe/edgeTTS.git /opt/edgetts
cd /opt/edgetts

pnpm install --frozen-lockfile
pnpm build
```

### 3. 创建低特权系统用户

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin edgetts
sudo chown -R root:root /opt/edgetts
sudo sh -c 'umask 077; set -C; printf "API_KEY=%s\n" "$(openssl rand -hex 32)" > /etc/edgetts.env'
```

### 4. 编写 Systemd 服务单元

创建 `/etc/systemd/system/edgetts.service`：

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

# 环境变量配置
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=8080
Environment=REQUIRE_API_KEY=true
EnvironmentFile=/etc/edgetts.env

# 系统沙盒与权限隔离
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

### 5. 启动并设置开机自启

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now edgetts
sudo systemctl status edgetts
```

## 版本更新与日常维护

先将 `compose.yaml` 中的 `image:` 改成要部署的已发布版本或摘要。`docker compose pull` 只拉取配置指定的镜像，不会把固定的 `0.7.0` 自动升级到其他版本。保留 `.env` 和上一版本镜像引用。

```bash
cd ~/edgetts
docker compose pull edgetts
docker compose up -d edgetts
curl --fail http://127.0.0.1:8080/health
```

回滚时恢复上一版本镜像引用并重复以上命令。源码构建方式需切换到目标代码版本，再执行 `docker compose up -d --build`。单实例替换期间会短暂停止接收请求；仍在传输的音频可能在服务端 30 秒停机期限后中断，不保证毫秒级或无中断更新。
