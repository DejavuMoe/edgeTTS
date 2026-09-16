# API 参考与集成指南

本文档介绍 `edgeTTS` 的所有 HTTP API 端点、请求/响应协议规范以及常见客户端的对接示例。

---

## 接口总览

| 请求方法 | 路由路径           | 需携带认证       | 说明                                            |
| :------- | :----------------- | :--------------- | :---------------------------------------------- |
| `GET`    | `/health`          | 否               | 基础健康检查，返回 `{"status":"ok"}`            |
| `GET`    | `/api/health`      | 否               | 带有 API 前缀的健康检查，返回 `{"status":"ok"}` |
| `GET`    | `/api/voices`      | 是（若启用认证） | 获取可用的 Edge TTS 音色列表                    |
| `POST`   | `/v1/audio/speech` | 是（若启用认证） | 兼容 OpenAI TTS 协议的流式语音合成接口          |
| `POST`   | `/api/speech`      | 是（若启用认证） | 原生分段长文本流式语音合成接口                  |

---

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

---

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

### Python 官方 OpenAI SDK 调用示例

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8080/v1",
    api_key="your-secret-api-key",
)

with client.audio.speech.with_streaming_response.create(
    model="tts-1",
    voice="zh-CN-XiaoxiaoNeural",
    input="你好，通过 Python OpenAI SDK 调用 edgeTTS 生成的音频流！",
) as response:
    response.stream_to_file("output.mp3")
```

### Node.js / TypeScript 官方 SDK 调用示例

```typescript
import fs from "node:fs";
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "http://127.0.0.1:8080/v1",
  apiKey: "your-secret-api-key",
});

async function main() {
  const response = await openai.audio.speech.create({
    model: "tts-1",
    voice: "zh-CN-XiaoxiaoNeural",
    input: "来自 Node.js 官方 SDK 的流式语音合成。",
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile("output.mp3", buffer);
}

void main();
```

## 2. 原生长文本流式接口 (`POST /api/speech`)

专为长篇文档、小说朗读、新闻播报设计，支持单次 HTTP 请求直接合成高达 **20,000 Unicode 码点** 的长文本。

### 服务端无损层次分段

当输入文本超过 300 码点时，服务端会按照确定性的分级边界规则自动拆分：
`段落 (\n\n) > 换行 (\n) > 句子标点 (. ! ? 。 ！？) > 空白字符 > 硬截断`

每个分段在上游串行合成，音频帧通过单个 HTTP 长连接流式拼接返回。所有分段重新拼接可 100% 还原原始输入文本，绝无字符丢失或意外修剪。

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
- `X-EdgeTTS-Segment-Count`: 服务端计划切分的总分段数。
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

---

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

---

## 4. 健康检查接口 (`GET /health`, `GET /api/health`)

用于检查 HTTP 进程是否响应，不探测上游或验证完整合成链路。

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

---

## 错误代码与状态码说明

所有错误响应均遵循统一的 `ApiError` JSON 结构：

```json
{
  "error": {
    "code": "错误代号",
    "message": "人类可读的详细错误说明"
  }
}
```

| HTTP 状态码               | 错误代号          | 原因分析                                                         |
| :------------------------ | :---------------- | :--------------------------------------------------------------- |
| `400 Bad Request`         | `INVALID_REQUEST` | 参数校验失败（如超出文本长度限制、非法字符、音色格式不合法等）。 |
| `401 Unauthorized`        | `UNAUTHORIZED`    | 请求未提供 API Key 或提供的密钥无效。                            |
| `404 Not Found`           | —                 | 访问的路由不存在。                                               |
| `429 Too Many Requests`   | `RATE_LIMITED`    | 触发接口准入频次限制（单进程默认 10 秒 12 次请求）。             |
| `502 Bad Gateway`         | `UPSTREAM_ERROR`  | 与微软 Edge TTS 上游 WebSocket 连接失败或上游拒绝合成。          |
| `503 Service Unavailable` | `SERVER_BUSY`     | 并发限制队列已满（超过 4 个正在合成任务 + 16 个排队槽位）。      |

分段器保留原文本，但合成会跳过纯空白分段；`X-EdgeTTS-Segment-Count` 统计实际提交合成的段数。健康接口仅报告进程存活，不探测微软、不验证音色列表，也不执行合成。

JSON 错误适用于音频响应头发出之前。开始传输后若上游出错，会终止音频连接；先前的 `200` 或段数不代表完整合成成功。应丢弃中断的下载并显式重试。音色查询限制为单进程每分钟 60 次，合成排队超过 30 秒返回 `503 SERVER_BUSY`。

| HTTP | Code                     |
| ---- | ------------------------ |
| 413  | `PAYLOAD_TOO_LARGE`      |
| 415  | `UNSUPPORTED_MEDIA_TYPE` |
| 500  | `INTERNAL_ERROR`         |
