# API 参考与集成指南

本文档介绍 `edgeTTS` 的所有 HTTP API 端点、请求/响应协议规范以及常见客户端的对接示例。

## 接口总览

| 请求方法 | 路由路径           | 需携带认证       | 说明                                            |
| :------- | :----------------- | :--------------- | :---------------------------------------------- |
| `GET`    | `/health`          | 否               | 基础健康检查，返回 `{"status":"ok"}`            |
| `GET`    | `/api/health`      | 否               | 带有 API 前缀的健康检查，返回 `{"status":"ok"}` |
| `GET`    | `/api/voices`      | 是（若启用认证） | 获取可用的 Edge TTS 音色列表                    |
| `POST`   | `/v1/audio/speech` | 是（若启用认证） | 兼容 OpenAI TTS 协议的流式语音合成接口          |
| `POST`   | `/api/speech`      | 是（若启用认证） | 原生分段长文本流式语音合成接口                  |

## 认证方式

当配置了 `API_KEY` 时，客户端发起的受保护请求必须在标准 HTTP 请求头中提供 API 密钥：

```http
Authorization: Bearer <API_KEY>
```

若缺少或密钥不匹配，服务端将返回 HTTP `401 Unauthorized`：

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing or invalid API key"
  }
}
```

## 1. OpenAI 兼容接口 (`POST /v1/audio/speech`)

该接口兼容下表列出的请求字段，并非完整 OpenAI API。音色必须使用 `/api/voices` 返回的 Edge ID，不映射 OpenAI 音色别名。`tts-1` 和 `tts-1-hd` 只选择 Edge 的 48/96 kbps MP3 输出，不代表使用 OpenAI 模型。其他格式及未知字段会被拒绝；客户端需允许自定义 Base URL 和音色 ID。

### 请求体参数（JSON）

| 参数名            | 类型     | 必填   | 说明                                                                                 |
| :---------------- | :------- | :----- | :----------------------------------------------------------------------------------- |
| `model`           | `string` | **是** | `"tts-1"`（标准音质，48 kbps）或 `"tts-1-hd"`（高品质，96 kbps）                     |
| `voice`           | `string` | **是** | Edge 音色 ID（如 `zh-CN-XiaoxiaoNeural`、`en-US-JennyNeural`、`ja-JP-NanamiNeural`） |
| `input`           | `string` | **是** | 待合成的文本（1–4,096 UTF-16 代码单元，符合 XML 规范字符）                           |
| `response_format` | `string` | 否     | 仅支持 `"mp3"`（默认且唯一支持格式）                                                 |
| `speed`           | `number` | 否     | 播放语速倍率，范围 `0.5` 至 `2.0`（默认 `1.0`）                                      |

### cURL 调用示例

```bash
curl -X POST http://127.0.0.1:8080/v1/audio/speech \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tts-1",
    "voice": "zh-CN-XiaoxiaoNeural",
    "input": "你好，这是 edgeTTS 的 OpenAI 兼容接口测试。",
    "response_format": "mp3",
    "speed": 1.0
  }' \
  --output speech.mp3
```

## 2. 原生长文本流式接口 (`POST /api/speech`)

专为长篇文档、小说朗读、新闻播报设计，支持单次 HTTP 请求直接合成高达 **20,000 Unicode 码点** 的长文本。

两条合成接口都按段落、换行、句子、空白的优先级分段，每段最多 300 Unicode 码点。分段器保留原始文本，合成时跳过纯空白段；各段串行合成，通过一个 HTTP 音频流返回。

### 请求体参数（JSON）

| 参数名           | 类型     | 必填   | 说明                                                     |
| :--------------- | :------- | :----- | :------------------------------------------------------- |
| `input`          | `string` | **是** | 待合成的文本（1–20,000 Unicode 码点，符合 XML 规范字符） |
| `voice`          | `string` | **是** | Edge 音色 ID（如 `zh-CN-XiaoxiaoNeural`）                |
| `quality`        | `string` | 否     | `"standard"`（48 kbps，默认）或 `"high"`（96 kbps）      |
| `speed`          | `number` | 否     | 语速调节倍率，`0.5` 至 `2.0`（默认 `1.0`）               |
| `pitchSemitones` | `number` | 否     | 音调半音微调，`-12.0` 至 `12.0`（默认 `0.0`）            |
| `volume`         | `number` | 否     | 音量缩放比例，`0.0` 至 `1.0`（默认 `1.0`）               |

### 响应头信息

- `Content-Type`: `audio/mpeg`
- `Cache-Control`: `no-store`
- `X-EdgeTTS-Segment-Count`: 计划合成的非空白段数，不表示已完成段数。
- `X-EdgeTTS-Segment-Max-Code-Points`: 单分段最大码点限制（`300`）。

### cURL 调用示例

```bash
curl -X POST http://127.0.0.1:8080/api/speech \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "这是一段较长的文本。edgeTTS 会在服务端进行无损分段，并通过单连接以 chunked 流式方式持续返回完整音频。",
    "voice": "zh-CN-XiaoxiaoNeural",
    "quality": "standard",
    "speed": 1.0,
    "pitchSemitones": 0.0,
    "volume": 1.0
  }' \
  --output long-speech.mp3
```

## 3. 音色查询接口 (`GET /api/voices`)

获取当前 Microsoft Edge TTS 支持的所有音色清单。数据在服务端内存中缓存 6 小时。

### cURL 调用示例

```bash
curl -s http://127.0.0.1:8080/api/voices \
  -H "Authorization: Bearer $API_KEY"
```

### 响应体示例

```json
{
  "voices": [
    {
      "id": "zh-CN-XiaoxiaoNeural",
      "displayName": "Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)",
      "locale": "zh-CN",
      "gender": "Female",
      "status": "GA",
      "suggestedCodec": "audio-24khz-48kbitrate-mono-mp3"
    },
    {
      "id": "en-US-JennyNeural",
      "displayName": "Microsoft Jenny Online (Natural) - English (United States)",
      "locale": "en-US",
      "gender": "Female",
      "status": "GA",
      "suggestedCodec": "audio-24khz-48kbitrate-mono-mp3"
    }
  ]
}
```

## 4. 健康检查接口 (`GET /health`, `GET /api/health`)

健康接口只检查 HTTP 进程存活，不访问微软，也不验证合成就绪。

### cURL 调用示例

```bash
curl -i http://127.0.0.1:8080/health
```

### 响应体

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{"status":"ok"}
```

## 错误代码与状态码说明

音频响应头发送前的错误使用下方 JSON 结构；流开始后的错误会终止连接。HTTP 200 不保证下载完整，应丢弃中断音频并显式重试。

```json
{ "error": { "code": "INVALID_REQUEST", "message": "Invalid request" } }
```

| HTTP | Code                     | 原因                   |
| ---- | ------------------------ | ---------------------- |
| 400  | `INVALID_REQUEST`        | 请求校验失败           |
| 401  | `UNAUTHORIZED`           | 密钥缺失或无效         |
| 404  | `NOT_FOUND`              | 路由或资源不存在       |
| 429  | `RATE_LIMITED`           | 准入配额耗尽           |
| 413  | `PAYLOAD_TOO_LARGE`      | 请求体过大             |
| 415  | `UNSUPPORTED_MEDIA_TYPE` | 不支持的 Content-Type  |
| 500  | `INTERNAL_ERROR`         | 内部错误               |
| 502  | `UPSTREAM_ERROR`         | 上游连接或合成失败     |
| 503  | `SERVER_BUSY`            | 队列满或排队超过 30 秒 |

两条语音接口共享单进程 12 次/10 秒配额，音色查询为单进程每分钟 60 次。详见[配置参考](configuration.zh-CN.md)。
