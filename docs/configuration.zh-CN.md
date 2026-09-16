# 配置参考手册

本文档详细说明 `edgeTTS` 的所有环境变量配置、认证行为、并发队列机制与容器安全基线。

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
| `REQUIRE_API_KEY`             | 是否强制开启 API Key 验证          | `true` 或 `false`                   | `false` (裸机 Node)<br>`true` (Docker Compose)     |
| `SPEECH_RATE_LIMIT_MAX`       | 单个时间窗口内允许的最大语音请求数 | 整数（`1`–`10000`）                 | `12`                                               |
| `SPEECH_RATE_LIMIT_WINDOW_MS` | 限流滑动时间窗口大小（毫秒）       | 整数（`100`–`3600000`）             | `10000`（10 秒）                                   |
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

当启用认证（`REQUIRE_API_KEY=true`）后，所有受保护接口均要求客户端在 HTTP 请求头中携带凭据：

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

语音合成路由（`/api/speech` 与 `/v1/audio/speech`）受滑动窗口限流器保护：

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
      "message": "Too many speech requests, please try again later"
    }
  }
  ```

---

## 音色元数据缓存

- `GET /api/voices` 获取的音色数据在服务端内存中缓存 **6 小时**（TTL）。
- 当上游网络发生异常或拉取失败时，引入 5 秒退避时间，避免持续重试导致雪崩。

---

## 容器运行时安全基线

官方 Docker 镜像依据生产最高安全标准构建：

- **非 root 运行**：采用系统用户 `node`（`UID 1000` / `GID 1000`）。
- **根文件系统只读**：启用 `--read-only`，杜绝恶意写入。
- **内核 Capabilities 清空**：清空全部 Linux 特权（`--cap-drop=ALL`）。
- **特权提升锁定**：配置 `no-new-privileges:true`。
- **内存临时目录**：仅挂载 `/tmp` 为 `tmpfs` 内存卷。
- **进程管理与优雅终止**：内置 `tini` 作为 1 号进程，配置 30 秒超时（`stop_grace_period: 30s`），确保容器重启时流式连接平滑断开。
