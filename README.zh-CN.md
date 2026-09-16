# edgeTTS

[![Release](https://img.shields.io/github/v/release/DejavuMoe/edgeTTS?color=blue)](https://github.com/DejavuMoe/edgeTTS/releases)
[![CI Status](https://img.shields.io/github/actions/workflow/status/DejavuMoe/edgeTTS/ci.yml?branch=main)](https://github.com/DejavuMoe/edgeTTS/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Docker GHCR](https://img.shields.io/badge/docker-GHCR-blue.svg)](https://github.com/DejavuMoe/edgeTTS/pkgs/container/edgetts)
[![Node Version](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](package.json)

[English](README.md) | 简体中文 | [日本語](README.ja.md)

edgeTTS 是一个基于微软 Edge TTS / 大声朗读服务构建的高性能自托管 Web 服务与交互式工作台。它提供开箱即用的 OpenAI 兼容语音合成接口、面向长篇文档（最高 20,000 码点）的原生分段流式接口，以及跨浏览器体验一致的现代化 Web 工作台。

> [!NOTE]
> edgeTTS 依赖微软 Edge TTS 在线服务。上游服务的可用性与音色由微软维护。edgeTTS 为独立的开源项目，与微软公司无商业关联，亦未获得官方背书。

---

## 核心特性

- **双语音合成接口**：
  - **OpenAI 兼容接口**（`POST /v1/audio/speech`）：可无缝替代 OpenAI 官方 TTS 服务，支持 `tts-1`（48 kbps）与 `tts-1-hd`（96 kbps）模型、Edge 全量音色、语速调节（0.5–2.0）及分片流式输出。
  - **原生流式长文本 API**（`POST /api/speech`）：单次 HTTP 请求即可合成高达 20,000 Unicode 码点的文本，服务端无损分段流式返回，提供细粒度韵律调节（语速、音调半音、音量）与分段元数据响应头。
- **无损分级文本分段**：
  - 精确基于 Unicode 码点分级切分（`段落 > 换行 > 句子标点 > 空白符 > 硬截断`），严格保护代理对与 CRLF 换行原子性。分段重新拼接后与原始文本完全一致，不做意外截断或字符变异。
- **公平并发与队列控制**：
  - 内置内存级 FIFO 并发限制器（4 个活跃合成流，16 个排队槽位）。长文本流在传输期间持续持有 1 个并发配额，避免中途断流或插队。客户端断开连接时立即中止上游合成。
- **现代化 Web 工作台**：
  - 定制无浏览器原生控件差别的轻量 UI 组件（`Select`、`Slider`、`Checkbox`、`AudioPlayer`），采用柔和护眼的 "warm-paper" 视觉体系。
  - 支持按地区筛选与全文检索音色，支持音色置顶收藏。
  - 支持本地 UTF-8 `.txt` 文本文件导入（上限 256 KiB / 20,000 码点，全部在浏览器本地读取解析，不上传服务端）。
  - 支持 `MediaSource` 渐进式流式播放与 Blob 自动降级，提供播放进度拖动与一键下载干净命名的 MP3 文件。
- **生产级安全与工程基线**：
  - 单源托管架构：Fastify 单端口同时承载前端 SPA 应用与后端 API 路由。
  - 隐私优先：不记录用户合成文本，无埋点统计，无外部遥测上报。
  - 基于常量时间的 API 密钥校验（`Authorization: Bearer <API_KEY>`）。
  - 严格容器安全沙盒：非 root 用户 `node`、只读根文件系统、清空全部特权（`cap-drop=ALL`）及禁止特权提升。

---

## 快速上手

### 方案 A：Docker Compose 预构建镜像（推荐）

创建部署目录并编写 `compose.yaml`：

```bash
mkdir -p ~/edgetts && cd ~/edgetts
```

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
```

生成强随机 API Key 并启动服务：

```bash
echo "API_KEY=$(openssl rand -hex 32)" > .env
docker compose up -d
```

### 方案 B：Docker 单容器运行 (`docker run`)

```bash
export API_KEY="$(openssl rand -hex 32)"

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

> [!IMPORTANT]
> **本地回环绑定（`127.0.0.1:8080:8080`）**：绑定至 `127.0.0.1` 可确保服务仅监听本机，避免未授权端口暴露在公网上。在互联网生产部署中，应在前方配置 HTTPS 反向代理（如 Nginx 或 Caddy）进行 TLS 证书终结。

### 验证服务状态

```bash
curl -i http://127.0.0.1:8080/health
```

预期返回：`HTTP/1.1 200 OK` 及 `{"status":"ok"}`。

在浏览器中打开 `http://127.0.0.1:8080` 即可直接使用 Web 工作台。

---

## 接口调用示例

### 1. OpenAI 兼容接口 (`POST /v1/audio/speech`)

```bash
curl -X POST http://127.0.0.1:8080/v1/audio/speech \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tts-1",
    "voice": "zh-CN-XiaoxiaoNeural",
    "input": "你好，世界！这是一段测试文本。",
    "response_format": "mp3",
    "speed": 1.0
  }' \
  --output speech.mp3
```

#### Python 官方 OpenAI SDK 接入

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8080/v1",
    api_key="your-secret-api-key",
)

with client.audio.speech.with_streaming_response.create(
    model="tts-1",
    voice="zh-CN-XiaoxiaoNeural",
    input="你好，来自 edgeTTS 的流式语音合成！",
) as response:
    response.stream_to_file("speech.mp3")
```

### 2. 原生长文本流式接口 (`POST /api/speech`)

```bash
curl -X POST http://127.0.0.1:8080/api/speech \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "这是一段较长的文本。edgeTTS 会在服务端无损分段并通过单个 HTTP 连接流式返回完整音频。",
    "voice": "zh-CN-XiaoxiaoNeural",
    "quality": "standard",
    "speed": 1.0,
    "pitchSemitones": 0.0,
    "volume": 1.0
  }' \
  --output long-speech.mp3
```

---

## 详细文档指南

我们在 [`docs/`](docs/) 目录中提供了完整的专项文档：

| 文档导航                                               | 内容说明                                                               |
| :----------------------------------------------------- | :--------------------------------------------------------------------- |
| [**自托管部署指南**](docs/deployment.zh-CN.md)         | Docker Compose、Docker 单容器、源码编译与 Linux systemd 原生服务部署。 |
| [**反向代理与 TLS 配置**](docs/reverse-proxy.zh-CN.md) | 生产环境 Nginx 与 Caddy 配置、语音流式无缓冲原则及自动化代理测试。     |
| [**配置参考手册**](docs/configuration.zh-CN.md)        | 环境变量参考表、认证安全机制、准入限流及并发队列控制。                 |
| [**API 参考与客户端集成**](docs/api.zh-CN.md)          | 完整端点协议、请求响应结构体、错误代码说明及常见第三方客户端对接。     |
| [**发布治理与安全供应链**](docs/releasing.md)          | 严格 SemVer 规范、OCI 镜像供应链多架构签名验证及不可变摘要锁定。       |

---

## 项目架构

```text
HTTP 路由 (apps/server)
       ↓
  TtsService (packages/tts-service)
       ↓
  TtsProvider (packages/tts-core)
       ↓
EdgeTtsProvider (packages/edge-provider)
       ↓
   msedge-tts (上游 WebSocket)
```

- `apps/server`：Fastify 服务组合根、HTTP 路由注册、速率限制及前端静态资产托管。
- `apps/web`：基于 React + Vite 的前端 Web 工作台，包含全套自研无障碍 UI 原语。
- `packages/tts-service`：中立业务编排层（音色缓存管理、并发限制器、长文本无损分段）。
- `packages/tts-core`：领域核心抽象与 Provider 端口契约。
- `packages/edge-provider`：微软 Edge 大声朗读服务 WebSocket 适配器。
- `packages/shared`：跨包共享的数据校验 Schema、通用类型及 Unicode 码点处理工具。

---

## 开源协议

本项目采用 [MIT License](LICENSE) 开源许可协议。
