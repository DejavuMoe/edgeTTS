# 反向代理配置指南

本文档介绍如何在生产环境中为 `edgeTTS` 配置 Nginx 或 Caddy 反向代理。

本示例假设代理运行在宿主机。代理也在容器内时，`127.0.0.1` 指向代理容器自身；应将两个服务接入私有 Docker 网络并使用 `edgetts:8080`。Nginx 示例要求证书文件已经存在，请先取得证书再执行 `nginx -t`。确定性代理脚本需要 Docker，即使关闭上游实时检查，也可能需要联网拉取镜像。

## 部署拓扑与核心原则

```text
客户端 (浏览器 / 移动端 / OpenAI 客户端)
                    │
              HTTPS (443 端口)
                    ▼
           反向代理 (Nginx / Caddy)
                    │
           HTTP (127.0.0.1:8080)
                    ▼
           edgeTTS 容器或后台服务
```

1. **本地回环隔离**：edgeTTS 仅监听 `127.0.0.1`，不直接暴露给外部公网接口。
2. **TLS 证书终结**：反向代理集中管理 SSL/TLS 证书并提供 HTTPS 加密传输。
3. **流式传输无缓冲准则（关键）**：针对流式语音合成接口（`/api/speech` 与 `/v1/audio/speech`），**必须禁用反向代理的响应缓冲**。微软 Edge TTS 是实时分片合成音频的，如果反向代理开启缓冲，客户端必须等待整个音频全部生成完毕或缓冲区填满才会接收到数据，导致播放延迟极高。
4. **请求头**：保留 `Authorization`，由代理设置转发请求头；转发 IP 不作为已认证的客户端身份，也不提供独立配额。

## Nginx 配置方案

使用[仓库内的 Nginx 模板](../../deploy/nginx/edgetts.conf.example)，替换域名和证书路径后启用。两条语音路由均保持响应缓冲与缓存关闭。

### 安装与生效（Ubuntu / Debian）

```bash
# 1. 复制配置文件
sudo cp deploy/nginx/edgetts.conf.example /etc/nginx/sites-available/edgetts.conf

# 2. 修改实际域名和 SSL 证书路径
sudo nano /etc/nginx/sites-available/edgetts.conf

# 3. 启用站点配置
sudo ln -s /etc/nginx/sites-available/edgetts.conf /etc/nginx/sites-enabled/edgetts.conf

# 4. 测试语法正确性
sudo nginx -t

# 5. 平滑重载 Nginx
sudo systemctl reload nginx
```

### 自动化代理验证脚本

仓库内提供了全自动的代理测试脚本 [`deploy/nginx/test-proxy.sh`](../../deploy/nginx/test-proxy.sh)。该脚本可在容器内验证配置语法、流式首包即时传输、错误状态码保留及请求头透传：

```bash
# 执行确定性验证（不调用微软上游）
EDGETTS_NGINX_SKIP_LIVE=1 ./deploy/nginx/test-proxy.sh
```

## Caddy 配置方案

Caddy 具有自动申请管理 Let's Encrypt / ZeroSSL 证书的特性，配置极为精简。

### `Caddyfile` 配置示例

```caddyfile
edgetts.example.com {
    encode zstd gzip

    # 流式语音接口 - 立即刷新每个分片
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

    # 默认路由（Web 工作台、静态文件、音色列表）
    handle {
        reverse_proxy 127.0.0.1:8080
    }
}
```

> [!TIP]
> `flush_interval -1` 指示 Caddy 在接收到 edgeTTS 返回的每个音频分片时立即推送到客户端，完全避免中间积压缓冲。

## 上线检查清单

在正式对外提供服务前，请检查以下关键点：

1. **流式首包延迟**：确认音频分片能经过代理逐步到达。启动延迟取决于上游、排队与浏览器，不承诺固定秒数。
2. **认证头透传**：确保带有 `Authorization: Bearer <API_KEY>` 的请求能正常访问，错误密钥能正确收到 401 响应。
3. **错误原样返回**：确保服务返回的 JSON 错误信息（400、401、429、502、503）原样呈现给客户端，未被反向代理拦截替换为默认错误页。
4. **健康状态探测**：访问 `GET /health` 确认返回 `200` 及 `{"status":"ok"}`。
