# 配置参考手册

本文档详细说明 `edgeTTS` 的所有环境变量配置、认证行为、并发队列机制与容器安全基线。

`REQUIRE_API_KEY` 控制缺少密钥时是否拒绝启动，不会关闭已配置密钥的验证。使用外部认证时，需同时设置 `REQUIRE_API_KEY=false` 并移除 `API_KEY`。production 默认要求密钥，本地开发可不设置。Node 不自动加载 `.env`；请使用导出的环境变量、`node --env-file=...` 或 systemd 的 `EnvironmentFile`。Compose 仅转发 `environment` 中列出的变量。

---

## 环境变量参考

### 应用程序服务配置

以下环境变量作用于 Fastify 应用服务端（`apps/server`）：

| 变量名                        | 说明                               | 可选值                              | 默认值                                             |
| :---------------------------- | :--------------------------------- | :---------------------------------- | :------------------------------------------------- |
| `HOST`                        | HTTP 服务监听的绑定 IP 地址        | 有效的 IPv4 / IPv6 地址             | `127.0.0.1` (裸机 Node)<br>`0.0.0.0` (Docker 容器) |
| `PORT`                        | HTTP 服务监听端口                  | `1`–`65535`                         | `8080`                                             |
| `NODE_ENV`                    | 运行环境模式                       | `production`, `development`, `test` | `production` (Docker)                              |
| `API_KEY`                     | Bearer 认证访问密钥                | 字符串（不少于 16 字符，无空白符）  | 无                                                 |
| `REQUIRE_API_KEY`             | 是否要求启动时必须配置密钥         | `true` 或 `false`                   | `true`（production / Compose）；其他环境 `false`   |
| `SPEECH_RATE_LIMIT_MAX`       | 单个时间窗口内允许的最大语音请求数 | 整数（`1`–`10000`）                 | `12`                                               |
| `SPEECH_RATE_LIMIT_WINDOW_MS` | 限流固定时间窗口大小（毫秒）       | 整数（`100`–`3600000`）             | `10000`（10 秒）                                   |
| `SERVE_STATIC`                | 是否启用 Fastify 前端静态资源托管  | `true` 或 `false`                   | `production` 环境下默认开启                        |
| `WEB_DIST_DIR`                | 前端编译产物存放的文件系统路径     | 绝对路径或相对路径                  | `/app/web-dist` (Docker)<br>`apps/web/dist` (Node) |

### Docker Compose 宿主机变量（`.env`）

以下变量在 `compose.yaml` 中用于控制宿主机端口映射：

| 变量名                 | 说明                         | 默认值      |
| :--------------------- | :--------------------------- | :---------- |
| `EDGETTS_BIND_ADDRESS` | 宿主机端口绑定的目标 IP 地址 | `127.0.0.1` |
| `EDGETTS_HOST_PORT`    | 宿主机对外映射的端口号       | `8080`      |

---

## 认证机制与安全架构

### Bearer Token 规范

只要配置了 `API_KEY`，所有受保护接口均要求客户端在 HTTP 请求头中携带凭据：

```http
Authorization: Bearer <API_KEY>
```

- **受保护接口**：`GET /api/voices`、`POST /api/speech`、`POST /v1/audio/speech`。
- **公开接口**：`GET /health`、`GET /api/health` 以及前端 Web 工作台静态资源（`GET /`）。

### 安全设计规范

1. **不支持 Query 参数传 Key**：系统明确**不接受**通过 URL 参数（如 `?api_key=` 或 `?token=`）传递凭据。URL 参数容易在反向代理访问日志、浏览器历史及 CDN 缓存中泄露。
2. **常量时间安全比对**：API Key 的校验基于底层 `crypto.timingSafeEqual` 与哈希计算，防范计时侧信道攻击（Timing Attacks）。
3. **最小长度限制**：密钥长度必须大于等于 16 字符，且不得包含空白符。
4. **前端工作台瞬态存储**：在 Web 工作台中输入的 API Key 严格保存在浏览器 React 运行时内存中，绝不写入 `localStorage`、`sessionStorage`、Cookie 或 URL Hash。刷新页面后需重新输入。

---

## 并发控制与队列管理

`edgeTTS` 实现了基于内存的公平并发限制器（`TtsService`）：

```text
接收请求
    │
    ▼
接口准入限流器 (单进程 12 次 / 10秒)
    │
    ▼
并发限制器 (TtsService Concurrency Limiter)
    │
    ├─ 活跃流 < 4   ──► 向上游发起合成
    │
    ├─ 活跃流 = 4   ──► 进入 FIFO 排队队列 (最多 16 个等待槽位)
    │
    └─ 队列已满 (16) ──► 503 状态码 (SERVER_BUSY)
```

- **长文本会话连续性**：长文本分段合成在整个连续流式返回期间仅占用 1 个并发许可，防止分段合成中途由于队列竞争发生阻塞中断。
- **客户端断开即时回收**：若客户端提前中断网络连接或中止 HTTP 请求，服务会立即终止与微软上游的 WebSocket 会话并立即归还并发槽位。

---

## 接口准入限流

语音合成路由（`/api/speech` 与 `/v1/audio/speech`）受固定窗口限流器保护：

- **默认限额**：单进程每 10 秒最多处理 12 次请求。
- **标准响应头**：
  - `X-RateLimit-Limit`：当前窗口最大请求配额。
  - `X-RateLimit-Remaining`：当前窗口剩余可用配额。
  - `X-RateLimit-Reset`：配额重置倒计时（秒）。
- **超限返回**：返回 HTTP 429 状态码及 JSON 错误体：
  ```json
  {
    "error": {
      "code": "RATE_LIMITED",
      "message": "Too many speech requests"
    }
  }
  ```

---

合成请求最多排队 **30 秒**，超时返回 `503 SERVER_BUSY`；此期限不限制已经开始的音频流。提供者连接建立期限为 10 秒、音频无数据期限为 120 秒，不保证总合成时长。

语音准入限额由两条路由和所有调用者共享，作用于单进程。这是单密钥服务，不提供租户隔离。需要区分不同可信客户端时，在可信网关配置客户端认证及配额，不把未经验证的转发 IP 当作身份。音色查询另有 **单进程每分钟 60 次** 的限制，在认证通过后计数；健康检查公开且不占用上述配额。

---

## 音色元数据缓存

- `GET /api/voices` 获取的音色数据在服务端内存中缓存 **6 小时**（TTL）。
- 首次请求时才获取音色，并发获取共享同一个请求。
- 刷新失败时继续返回已有列表，固定等待 5 秒后允许重试；冷缓存没有旧数据回退或退避。
- 上游获取有 10 秒逻辑超时，依赖库无法取消底层 HTTP 请求。

---

## 容器运行时安全基线

镜像默认以 `node` 用户运行。推荐的 Compose / `docker run` 参数额外启用只读根目录、`cap_drop=ALL`、禁止提权、`/tmp` tmpfs 和 Docker 注入的 init 进程（`init: true` / `--init`）。这些运行时限制不内置在镜像中。

服务端发送 `nosniff`、Referrer 策略、摄像头/麦克风/定位限制和 CSP。CSP 允许同源脚本、控件所需的内联样式以及 `blob:` 音频，禁止内联脚本和跨源页面嵌入。HTTPS 仍由反向代理提供。
