# edgeTTS

[English](README.md) | 简体中文 | [日本語](README.ja.md)

edgeTTS 是一个基于微软 Edge TTS / Edge 大声朗读能力构建的自托管 Web 应用程序与流式 HTTP 语音合成服务。

项目提供交互式 Web 工作台、面向长文本的原生分段语音 API、兼容 OpenAI 的 TTS 端点子集，以及生产就绪的容器化部署方案。

> [!NOTE]
> edgeTTS 依赖微软 Edge TTS 上游服务。上游服务的可用性、音色支持与运行表现不在本项目控制范围内。edgeTTS 是独立的开源项目，未获得微软公司的赞助或官方背书。

当前稳定发布版本：[v0.2.0](https://github.com/DejavuMoe/edgeTTS/releases/tag/v0.2.0)

---

## 核心特性

- **双语音接口**：
  - **OpenAI 兼容 TTS 子集**（`POST /v1/audio/speech`）：兼容 OpenAI TTS 客户端调用，支持 `tts-1`（`mp3-48k`）与 `tts-1-hd`（`mp3-96k`）模型、Edge 音色 ID、1–4,096 字符输入及 0.5–2.0 语速调节。
  - **原生流式长文本 API**（`POST /api/speech`）：单次 HTTP 请求支持合成高达 20,000 Unicode 码点的文本，支持标准品质（`mp3-48k`）与高品质（`mp3-96k`）、精细韵律控制（语速、音调半音、音量）以及响应头中的确定性分段元数据。
- **无损文本分段**：
  - 分级边界分段机制（`段落 > 换行 > 标点句子 > 空白符 > 硬截断`），精确基于 Unicode 码点计算，保留代理对与 CRLF 原子性。
  - 分段重新拼接可无损还原原始输入文本，不做意外变异或自动首尾裁剪。
- **公平并发控制**：
  - 内置内存 FIFO 队列限制器（4 个活跃并发流，16 个等待队列槽位）。
  - 长文本分段合成在整个有序流期间持有一个并发许可，避免流播放中途因排队竞争而中断，并限制并发上游会话。
  - 客户端提前断开连接时，立即中止已排队请求与上游正在合成的流。
- **Web 工作台**：
  - React 单页应用，具备双模式音频播放：优先使用 `MediaSource` 渐进式流式播放，不支持时平滑降级为 Blob 对象 URL。
  - 音色检索与地区过滤、收藏夹置顶保存。
  - 本地 UTF-8 `.txt` 文件导入（浏览器本地读取，上限 256 KiB / 20,000 码点；导入步骤不会上传或持久化文件。点击合成后，文本会发送到配置的服务及其 Microsoft Edge TTS 上游）。
  - 键盘快捷键：`Ctrl+Enter` / `Cmd+Enter` 触发合成，`Escape` 取消当前合成。
  - 实时文本统计与流式遥测显示（请求状态、流式状态、计划分段总数以及实际已接收音频字节数）。
- **同源静态托管**：
  - Fastify 服务端同源托管前端静态资源（`apps/web/dist`）与 API 接口。
  - 哈希静态资源长效缓存、`index.html` 协商缓存，以及无副作用的 SPA 回退路由。
- **安全与隐私**：
  - 不记录合成输入文本，也不收集分析数据或向外部发送遥测数据；输入内容和认证信息不会持久化到磁盘。
  - 可选 API Key 认证，通过 `Authorization: Bearer <API_KEY>` 请求头进行常量时间比对验证。
  - 生产容器安全基线：非 root 用户 `node`、只读根文件系统、清空全部 Linux Capabilities（`ALL`）及禁止特权提升。

---

## 快速上手（推荐 Docker 镜像）

部署 edgeTTS 最推荐且最便捷的方式是使用 GitHub Container Registry (GHCR) 发布的官方多架构容器镜像。

### 1. 生成 API Key

```bash
openssl rand -hex 32
```

### 2. 启动容器

```bash
export EDGETTS_API_KEY='<生成的密钥>'

docker run -d \
  --name edgetts \
  --restart unless-stopped \
  --init \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --tmpfs /tmp \
  --stop-timeout 30 \
  -e API_KEY="$EDGETTS_API_KEY" \
  -e REQUIRE_API_KEY=true \
  -p 127.0.0.1:8080:8080 \
  ghcr.io/dejavumoe/edgetts:0.2.0
```

### 3. 验证部署状态

```bash
curl http://127.0.0.1:8080/health
```

预期返回：

```json
{ "status": "ok" }
```

在浏览器中打开 `http://127.0.0.1:8080` 即可使用 Web 工作台。

> [!IMPORTANT]
> **本地回环绑定（`127.0.0.1:8080:8080`）**：绑定至 `127.0.0.1` 确保 edgeTTS 仅监听本地，不直接暴露在公网上。在互联网生产部署中，应在前方配置 HTTPS 反向代理（如 Nginx）处理 TLS 证书终结。

### 容器镜像标签与摘要说明

| 引用形式                                            | 用途说明                               | 可变性                     |
| --------------------------------------------------- | -------------------------------------- | -------------------------- |
| `ghcr.io/dejavumoe/edgetts:0.2.0`                   | 推荐用于常规生产部署的稳定版本         | 发布标签                   |
| `ghcr.io/dejavumoe/edgetts@sha256:<release-digest>` | 严格可复现的不可变生产环境锁定         | 内容寻址摘要（绝对不可变） |
| `ghcr.io/dejavumoe/edgetts:latest`                  | 始终指向已发布的最高稳定 SemVer 版本   | 可移动别名                 |
| `ghcr.io/dejavumoe/edgetts:main`                    | 源自 `main` 分支最新验证通过的开发快照 | 浮动快照                   |

如需不可变的生产部署锁定，请使用 `ghcr.io/dejavumoe/edgetts@sha256:<release-digest>`；每个稳定版本的已验证摘要均记录在其 [GitHub Release 说明](https://github.com/DejavuMoe/edgeTTS/releases)中。

---

## 安装与部署方式

### 方式 1：直接运行官方预构建镜像 (GHCR)

参见上方的 [快速上手](#快速上手推荐-docker-镜像) 章节。

### 方式 2：使用 Docker Compose（本地源码构建）

代码仓库中自带的 `compose.yaml` 配置为直接基于本地源码构建容器镜像（`build: context: .`），而非直接拉取 GHCR 镜像。

```bash
git clone https://github.com/DejavuMoe/edgeTTS.git
cd edgeTTS

cp .env.example .env
```

生成安全 API Key：

```bash
openssl rand -hex 32
```

编辑 `.env` 文件填入密钥：

```env
API_KEY=填入你生成的随机密钥
REQUIRE_API_KEY=true
EDGETTS_BIND_ADDRESS=127.0.0.1
EDGETTS_HOST_PORT=8080
```

启动服务：

```bash
docker compose up -d --build
```

容器管理命令：

```bash
# 查看容器状态
docker compose ps

# 查看日志
docker compose logs -f edgetts

# 健康检查
curl http://127.0.0.1:8080/health

# 停止并移除容器
docker compose down
```

### 方式 3：直接从源码构建运行（Node.js 与 pnpm）

#### 环境要求

- **Node.js**: `24` LTS
- **pnpm**: `12.3.4`（与根目录 `package.json` 中的 `packageManager` 一致）

#### 编译与启动

```bash
git clone https://github.com/DejavuMoe/edgeTTS.git
cd edgeTTS

# 安装依赖并编译全部子包与前端应用
pnpm install --frozen-lockfile
pnpm build

# 生成随机密钥
export API_KEY="$(openssl rand -hex 32)"

# 启动生产服务
NODE_ENV=production \
HOST=127.0.0.1 \
PORT=8080 \
API_KEY="$API_KEY" \
REQUIRE_API_KEY=true \
node apps/server/dist/server.js
```

> [!NOTE]
> 在直接通过 Node.js 运行时，`HOST` 默认值为 `127.0.0.1`，`REQUIRE_API_KEY` 默认值为 `false`。生产环境中请务必显式指定 `REQUIRE_API_KEY=true` 并配置 `API_KEY`。

### 方式 4：本地开发模式

同时以热重载模式启动 Fastify 后端与 Vite 前端开发服务器：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

- **后端 API 服务**：`http://127.0.0.1:8080`
- **前端开发工作台**：`http://localhost:5173`（代理 `/api` 与 `/v1` 到 8080 端口）

---

## 生产反向代理配置 (Nginx)

面向互联网的生产部署中，应使用 Nginx 进行 TLS 终结，并将请求代理转发至仅监听在 `127.0.0.1:8080` 的 edgeTTS 服务：

```text
互联网客户端（浏览器 / 外部 API 调用）
                      │
               HTTPS (端口 443)
                      ▼
              Nginx 反向代理
                      │
            HTTP/1.1 (127.0.0.1:8080)
                      ▼
               edgeTTS 服务
```

### 部署步骤（Debian / Ubuntu）

```bash
# 1. 复制配置模板
sudo cp deploy/nginx/edgetts.conf.example /etc/nginx/sites-available/edgetts.conf
sudo ln -s /etc/nginx/sites-available/edgetts.conf /etc/nginx/sites-enabled/edgetts.conf

# 2. 编辑域名及实际 TLS 证书路径
sudo nano /etc/nginx/sites-available/edgetts.conf

# 3. 检查 Nginx 配置语法
sudo nginx -t

# 4. 平滑重载 Nginx
sudo systemctl reload nginx
```

### 关键流式代理配置说明

在 `deploy/nginx/edgetts.conf.example` 中，响应缓冲针对流式语音接口被**显式禁用**：

```nginx
location = /api/speech {
    proxy_pass http://edgetts_backend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
    proxy_send_timeout 60s;
}

location = /v1/audio/speech {
    proxy_pass http://edgetts_backend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
    proxy_send_timeout 60s;
}
```

> [!WARNING]
> 切勿在全局或根路径（`location /`）下开启 `proxy_buffering off;`。前端静态资源与常规 API 应保持默认缓冲以保证传输效率，仅在 `/api/speech` 与 `/v1/audio/speech` 关闭缓冲。

完整说明与自动化验证测试详见 [`deploy/nginx/README.md`](deploy/nginx/README.md)。只要其他反向代理能够完整透传 `Authorization` 头且不缓冲流式音频，亦可正常使用。

---

## 身份认证机制

当启用认证（`REQUIRE_API_KEY=true`）时，所有受保护请求必须在 HTTP 请求头中提供 Bearer Token：

```http
Authorization: Bearer <API_KEY>
```

- **不支持 URL Query 参数认证**（不支持 `?api_key=` 或 `?token=`）。
- **公开无需认证的端点**：`GET /health`、`GET /api/health`，以及前端工作台页面（`GET /`）。
- **受保护需认证的端点**：`GET /api/voices`、`POST /api/speech`，以及 `POST /v1/audio/speech`。
- 密钥比对采用常量时间算法（`crypto.timingSafeEqual`），有效防范基于时序的侧信道攻击。API Key 要求至少 16 个字符且不能包含空格。
- **Web 工作台 API Key 存储机制**：在工作台设置中输入的 API Key 严格仅保留在当前浏览器的内存中（React 状态），绝不写入 `localStorage`、`sessionStorage`、Cookies 或 URL 中。刷新页面后需要重新填入。

---

## Web 工作台功能

内置的前端 Web 工作台提供直观高效的合成体验：

- **音色检索**：支持按音色名称、ID、语言地区进行即时搜索过滤；支持收藏夹置顶，并在刷新后保持选定音色状态。
- **细粒度韵律调节**：精准调节 `语速`（0.5–2.0）、`音调`（-12 至 +12 半音）、`音量`（0–1）。
- **音质切换**：提供标准音质（`mp3-48k`）与高品质（`mp3-96k`）选项。
- **本地 UTF-8 TXT 导入**：支持直接导入上限 256 KiB 且不超过 20,000 Unicode 码点的本地 `.txt` 文件。文件直接在浏览器中通过 `TextDecoder('utf-8', { fatal: true })` 解码，不上传至服务器，不在磁盘落地。
- **键盘快捷键**：`Ctrl+Enter`（Windows/Linux）或 `Cmd+Enter`（macOS）快速发起合成；`Escape` 键立即取消当前正在进行的合成。
- **双模式播放器**：优先使用 `MediaSource` 和 `SourceBuffer` 实现边接收边流式播放；在不支持的环境中自动降级为 Blob URL 播放。支持单键下载规范化命名的 MP3 文件。
- **真实流式遥测**：界面展示真实的合成状态（请求中状态、流式播放状态、服务端计划分段数，以及实际已接收音频字节数）。edgeTTS 不展示虚假的百分比进度条、预估剩余时间 (ETA) 或已完成段落计数器。

---

## API 接口参考

### 接口总览

| 请求方法 | 路径               | 认证要求       | 说明                                             |
| -------- | ------------------ | -------------- | ------------------------------------------------ |
| `GET`    | `/health`          | 无需认证       | 基础健康检查，返回 `{"status":"ok"}`             |
| `GET`    | `/api/health`      | 无需认证       | 带 `/api` 前缀的健康检查，返回 `{"status":"ok"}` |
| `GET`    | `/api/voices`      | 启用认证时需要 | 获取服务端缓存的可用 Edge TTS 音色列表           |
| `POST`   | `/v1/audio/speech` | 启用认证时需要 | 兼容 OpenAI 的流式 TTS 端点子集                  |
| `POST`   | `/api/speech`      | 启用认证时需要 | 原生长文本分段流式语音合成 API                   |

### 1. 兼容 OpenAI 的 TTS 接口 (`POST /v1/audio/speech`)

为 OpenAI TTS 客户端提供的兼容子集接口，响应流式 MP3 音频。

#### 请求字段

- `model`（字符串，必填）：`"tts-1"`（对应 `mp3-48k`）或 `"tts-1-hd"`（对应 `mp3-96k`）。
- `voice`（字符串，必填）：Edge TTS 音色标识符（例如 `zh-CN-XiaoxiaoNeural`、`en-US-JennyNeural`）。
- `input`（字符串，必填）：待合成文本（1–4,096 字符）。
- `response_format`（字符串，选填）：仅支持 `"mp3"`（默认值：`"mp3"`）。
- `speed`（数值，选填）：语速系数，范围 `0.5` 至 `2.0`（默认值：`1.0`）。

#### 示例请求

```bash
curl -X POST http://127.0.0.1:8080/v1/audio/speech \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tts-1",
    "voice": "zh-CN-XiaoxiaoNeural",
    "input": "你好，世界。",
    "response_format": "mp3",
    "speed": 1.0
  }' \
  --output speech.mp3
```

_(若未开启 API Key 认证，可省略 `Authorization` 请求头)_

### 2. 原生长文本流式合成接口 (`POST /api/speech`)

支持高达 20,000 Unicode 码点的文本输入。长文本在服务端执行无损语义分段，并通过单条持久 HTTP 连接顺序流式输出完整音频。

#### 请求字段

- `input`（字符串，必填）：待合成文本（1–20,000 Unicode 码点）。
- `voice`（字符串，必填）：Edge TTS 音色标识符。
- `quality`（字符串，选填）：`"standard"`（`mp3-48k`，默认）或 `"high"`（`mp3-96k`）。
- `speed`（数值，选填）：语速倍率，范围 `0.5` 至 `2.0`（默认值：`1.0`）。
- `pitchSemitones`（数值，选填）：音调调整半音数，范围 `-12.0` 至 `12.0`（默认值：`0.0`）。
- `volume`（数值，选填）：音量比例，范围 `0.0` 至 `1.0`（默认值：`1.0`）。

#### 响应头信息

成功响应中附带服务端确定的分段规划元数据头：

- `X-EdgeTTS-Segment-Count`：本次请求规划的分段总数。
- `X-EdgeTTS-Segment-Max-Code-Points`：单段最大码点上限（固定为 `300`）。

#### 示例请求

```bash
curl -X POST http://127.0.0.1:8080/api/speech \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "这是一段较长的文本，服务端会在无损分段后通过单连接流式返回完整音频。",
    "voice": "zh-CN-XiaoxiaoNeural",
    "quality": "standard",
    "speed": 1.0,
    "pitchSemitones": 0.0,
    "volume": 1.0
  }' \
  --output long-speech.mp3
```

---

## 配置参数说明

### Fastify 服务端运行时环境变量

配置后端应用服务（`apps/server`）：

| 变量名                        | 说明                               | 允许值                              | 默认值                                                   |
| ----------------------------- | ---------------------------------- | ----------------------------------- | -------------------------------------------------------- |
| `HOST`                        | HTTP 服务监听的绑定地址            | IPv4 / IPv6 地址                    | `127.0.0.1`（直接运行 Node），`0.0.0.0`（Docker 容器内） |
| `PORT`                        | HTTP 服务监听端口                  | 端口整数（1–65535）                 | `8080`                                                   |
| `NODE_ENV`                    | 应用运行环境模式                   | `production`、`development`、`test` | `undefined`                                              |
| `API_KEY`                     | Bearer 认证所用的访问密钥          | 字符串（不少于 16 字符，无空格）    | 无默认值                                                 |
| `REQUIRE_API_KEY`             | 是否强制开启 API Key 校验          | `true` 或 `false`                   | `false`（直接运行 Node），`true`（Compose 默认）         |
| `SPEECH_RATE_LIMIT_MAX`       | 时间窗口内允许的最大语音请求数     | 整数，范围 `1` 至 `10000`           | `12`                                                     |
| `SPEECH_RATE_LIMIT_WINDOW_MS` | 频率限制时间窗口大小（毫秒）       | 整数，范围 `100` 至 `3600000`       | `10000`（10 秒）                                         |
| `SERVE_STATIC`                | 是否启用 Fastify 前端单页托管      | `true` 或 `false`                   | 当 `NODE_ENV=production` 时自动启用                      |
| `WEB_DIST_DIR`                | 前端静态构建输出目录绝对或相对路径 | 目录路径字符串                      | 相对路径 `apps/web/dist`                                 |

### Docker Compose 宿主机侧环境变量（`.env`）

配置 `compose.yaml` 中宿主机的端口映射与网络绑定：

| 变量名                 | 说明                               | 默认值      |
| ---------------------- | ---------------------------------- | ----------- |
| `EDGETTS_BIND_ADDRESS` | 容器端口映射到宿主机的监听 IP 地址 | `127.0.0.1` |
| `EDGETTS_HOST_PORT`    | 映射到容器 8080 端口的宿主机端口   | `8080`      |

### 内置保护限制（单进程内存控制）

- **语音接入频控**：默认在 10 秒窗口内合计最多允许 12 次请求（`/v1/audio/speech` 与 `/api/speech` 共享额度），超额返回 HTTP 429。
- **并发合成限制**：默认最多 4 个活跃合成流，16 个排队请求。长文本分段会话从首段到流完成或取消期间持有一个许可。队列满时返回 HTTP 503。

---

## 容器架构与安全基线

官方 GHCR 镜像原生支持多平台架构（`linux/amd64` 与 `linux/arm64`），并附带密码学可验证的供应链证据（SLSA provenance 与 SPDX SBOM）。

### 容器安全强化措施

- **非 root 用户运行**：容器默认以无特权用户 `node`（UID/GID 1000:1000）运行。
- **只读文件系统**：通过 `--read-only` 或 Compose 中的 `read_only: true` 启用。
- **清空 Linux Capabilities**：丢弃所有宿主内核能力（`--cap-drop=ALL`）。
- **禁止特权提升**：设置 `no-new-privileges:true`。
- **临时目录挂载**：仅为 `/tmp` 挂载内存临时文件系统（`--tmpfs /tmp`）。
- **Init 进程托管**：通过 `--init` 正确回收僵尸子进程并转发终止信号。
- **平滑停机机制**：30 秒停机缓冲（`--stop-timeout 30`）；超过期限时容器会终止剩余连接，因此不保证任意长度的流都能完成。

---

## 模块架构

```text
HTTP 请求 (apps/server)
       ↓
  TtsService (packages/tts-service)
       ↓
  TtsProvider (packages/tts-core)
       ↓
EdgeTtsProvider (packages/edge-provider)
       ↓
   msedge-tts
```

- `apps/server`：Fastify HTTP 服务与装配根节点（`@edgetts/server`）。
- `apps/web`：React + Vite 前端工作台应用（`@edgetts/web`）。
- `packages/shared`：共享数据模式、类型定义与 Unicode 工具（`@edgetts/shared`）。
- `packages/tts-core`：领域接口与契约定义（`@edgetts/tts-core`）。
- `packages/edge-provider`：微软 Edge 大声朗读服务适配器（`@edgetts/edge-provider`）。
- `packages/tts-service`：音色内存缓存、并发调度与长文本无损分段服务（`@edgetts/tts-service`）。

---

## 关联文档

- [Nginx 生产反向代理部署指南](deploy/nginx/README.md)
- [版本发布治理与回滚流程](docs/releasing.md)
- [GitHub Release v0.2.0](https://github.com/DejavuMoe/edgeTTS/releases/tag/v0.2.0)
- [MIT 许可证](LICENSE)

---

## 许可证

本项目采用 [MIT 许可证](LICENSE) 开源。
