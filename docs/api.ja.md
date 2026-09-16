# API リファレンス & 連携ガイド

このドキュメントでは、`edgeTTS` の全 HTTP API エンドポイント、リクエスト/レスポンス仕様、および主要クライアントとの連携例を解説します。

---

## エンドポイント一覧

| メソッド | パス               | 認証要否         | 説明                                                      |
| :------- | :----------------- | :--------------- | :-------------------------------------------------------- |
| `GET`    | `/health`          | 不要             | 基本ヘルスチェック（`{"status":"ok"}`）                   |
| `GET`    | `/api/health`      | 不要             | API プレフィックス付きヘルスチェック（`{"status":"ok"}`） |
| `GET`    | `/api/voices`      | 要（認証有効時） | 利用可能な Edge TTS 音色一覧を取得                        |
| `POST`   | `/v1/audio/speech` | 要（認証有効時） | OpenAI 互換ストリーミング音声合成                         |
| `POST`   | `/api/speech`      | 要（認証有効時） | ネイティブ長文分割ストリーミング音声合成                  |

---

## 認証方式

認証が有効な場合（`REQUIRE_API_KEY=true`）、保護されたエンドポイントへのリクエストには HTTP `Authorization` ヘッダーが必要です：

```http
Authorization: Bearer <API_KEY>
```

未認証またはキーが不正な場合、HTTP `401 Unauthorized` が返却されます：

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing or invalid API key"
  }
}
```

---

## 1. OpenAI 互換音声合成 API (`POST /v1/audio/speech`)

OpenAI Audio Speech API 仕様に準拠しており、ChatGPT-Next-Web、One API、各種 AI エージェント等の外部ツールと直接連携できます。

### リクエストパラメータ（JSON）

| パラメータ        | 型       | 必須     | 説明                                                                                  |
| :---------------- | :------- | :------- | :------------------------------------------------------------------------------------ |
| `model`           | `string` | **必須** | `"tts-1"`（標準、48 kbps）または `"tts-1-hd"`（高音質、96 kbps）                      |
| `voice`           | `string` | **必須** | Edge 音色 ID（例: `ja-JP-NanamiNeural`、`zh-CN-XiaoxiaoNeural`、`en-US-JennyNeural`） |
| `input`           | `string` | **必須** | 合成対象テキスト（1〜4,096 文字、XML 互換文字）                                       |
| `response_format` | `string` | 任意     | `"mp3"`（デフォルトかつ唯一の対応形式）                                               |
| `speed`           | `number` | 任意     | 再生速度倍率（`0.5`〜`2.0`、デフォルト `1.0`）                                        |

### cURL 実行例

```bash
curl -X POST http://127.0.0.1:8080/v1/audio/speech \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tts-1",
    "voice": "ja-JP-NanamiNeural",
    "input": "こんにちは。edgeTTS の OpenAI 互換エンドポイントのテストです。",
    "response_format": "mp3",
    "speed": 1.0
  }' \
  --output speech.mp3
```

### Python 公式 OpenAI SDK での利用例

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8080/v1",
    api_key="your-secret-api-key",
)

with client.audio.speech.with_streaming_response.create(
    model="tts-1",
    voice="ja-JP-NanamiNeural",
    input="Python OpenAI SDK からストリーミング再生を行っています。",
) as response:
    response.stream_to_file("output.mp3")
```

---

## 2. ネイティブ長文ストリーミング API (`POST /api/speech`)

1 回の HTTP リクエストで最大 **20,000 Unicode コードポイント** までの長文（ドキュメント、小説等）をストリーミング合成します。

### サーバーサイド可逆階層分割

入力テキストが 300 コードポイントを超える場合、サーバー側で以下の規則に従い自動分割されます：
`段落 (\n\n) > 改行 (\n) > 文末記号 (. ! ? 。 ！？) > 空白 > 強制切断`

各チャンクはシリアルに合成され、1 つの HTTP レスポンスストリームとして結合されてクライアントに送信されます。

### リクエストパラメータ（JSON）

| パラメータ       | 型       | 必須     | 説明                                                |
| :--------------- | :------- | :------- | :-------------------------------------------------- |
| `input`          | `string` | **必須** | 合成対象テキスト（1〜20,000 コードポイント）        |
| `voice`          | `string` | **必須** | Edge 音色 ID（例: `ja-JP-NanamiNeural`）            |
| `quality`        | `string` | 任意     | `"standard"`（48 kbps）または `"high"`（96 kbps）   |
| `speed`          | `number` | 任意     | 速度倍率（`0.5`〜`2.0`、デフォルト `1.0`）          |
| `pitchSemitones` | `number` | 任意     | ピッチ半音調整（`-12.0`〜`12.0`、デフォルト `0.0`） |
| `volume`         | `number` | 任意     | 音量スケール（`0.0`〜`1.0`、デフォルト `1.0`）      |

### レスポンスヘッダー

- `Content-Type`: `audio/mpeg`
- `Cache-Control`: `no-store`
- `X-EdgeTTS-Segment-Count`: 計画された分割総数
- `X-EdgeTTS-Segment-Max-Code-Points`: 1 チャンクあたりの最大コードポイント（`300`）

---

## 3. 音色一覧取得 API (`GET /api/voices`)

Microsoft Edge TTS で現在利用可能な音色一覧を返します（6 時間キャッシュ）。

### cURL 実行例

```bash
curl -s http://127.0.0.1:8080/api/voices \
  -H "Authorization: Bearer $API_KEY"
```

---

## 4. ヘルスチェック API (`GET /health`)

```bash
curl -i http://127.0.0.1:8080/health
```

返却値: `HTTP/1.1 200 OK`、`{"status":"ok"}`。

---

## エラーレスポンスとステータスコード

すべてのエラーは以下の形式で返却されます：

```json
{
  "error": {
    "code": "エラー識別子",
    "message": "エラー説明文"
  }
}
```

| ステータス                | コード            | 発生原因                                                           |
| :------------------------ | :---------------- | :----------------------------------------------------------------- |
| `400 Bad Request`         | `INVALID_REQUEST` | バリデーション失敗（テキスト長上限超過、不正文字、不正な音色名等） |
| `401 Unauthorized`        | `UNAUTHORIZED`    | API キーの指定漏れまたはキー不一致                                 |
| `404 Not Found`           | —                 | エンドポイントが存在しない                                         |
| `429 Too Many Requests`   | `RATE_LIMITED`    | レート制限の超過（単一プロセスあたり 10 秒 12 回上限）             |
| `502 Bad Gateway`         | `UPSTREAM_ERROR`  | アップストリーム（Microsoft）への接続失敗または合成拒絶            |
| `503 Service Unavailable` | `SERVER_BUSY`     | 並行合成キューが満杯（実行中 4 件 + 待機 16 件超過）               |
