# API リファレンス & 連携ガイド

このドキュメントでは、`edgeTTS` の全 HTTP API エンドポイント、リクエスト/レスポンス仕様、および主要クライアントとの連携例を解説します。

## エンドポイント一覧

| メソッド | パス               | 認証要否         | 説明                                                      |
| :------- | :----------------- | :--------------- | :-------------------------------------------------------- |
| `GET`    | `/health`          | 不要             | 基本ヘルスチェック（`{"status":"ok"}`）                   |
| `GET`    | `/api/health`      | 不要             | API プレフィックス付きヘルスチェック（`{"status":"ok"}`） |
| `GET`    | `/api/voices`      | 要（認証有効時） | 利用可能な Edge TTS 音色一覧を取得                        |
| `POST`   | `/v1/audio/speech` | 要（認証有効時） | OpenAI 互換ストリーミング音声合成                         |
| `POST`   | `/api/speech`      | 要（認証有効時） | ネイティブ長文分割ストリーミング音声合成                  |

## 認証方式

`API_KEY` が設定されている場合、保護されたエンドポイントへのリクエストには HTTP `Authorization` ヘッダーが必要です：

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

## 1. OpenAI 互換音声合成 API (`POST /v1/audio/speech`)

対応範囲は以下のリクエスト項目であり、OpenAI API 全体との互換性ではありません。音色は `/api/voices` の Edge ID を指定し、OpenAI 音色名への変換は行いません。`tts-1` と `tts-1-hd` は Edge の 48/96 kbps MP3 を選択する名前で、OpenAI モデルを使用するわけではありません。未対応形式や未知の項目は拒否します。クライアント側で Base URL と音色 ID を指定できる必要があります。

### リクエストパラメータ（JSON）

| パラメータ        | 型       | 必須     | 説明                                                                                  |
| :---------------- | :------- | :------- | :------------------------------------------------------------------------------------ |
| `model`           | `string` | **必須** | `"tts-1"`（標準、48 kbps）または `"tts-1-hd"`（高音質、96 kbps）                      |
| `voice`           | `string` | **必須** | Edge 音色 ID（例: `ja-JP-NanamiNeural`、`zh-CN-XiaoxiaoNeural`、`en-US-JennyNeural`） |
| `input`           | `string` | **必須** | 合成対象テキスト（1〜4,096 UTF-16 コード単位、XML 互換文字）                          |
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

## 2. ネイティブ長文ストリーミング API (`POST /api/speech`)

1 回の HTTP リクエストで最大 **20,000 Unicode コードポイント** までの長文（ドキュメント、小説等）をストリーミング合成します。

両音声 API は段落、改行、文末、空白の優先順で分割し、1 チャンクは最大 300 Unicode コードポイントです。分割器は元のテキストを保持し、合成時は空白のみのチャンクを省略します。各チャンクを順番に合成し、1 本の HTTP 音声応答として返します。

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
- `X-EdgeTTS-Segment-Count`: 合成予定の非空白チャンク数。完了チャンク数ではありません。
- `X-EdgeTTS-Segment-Max-Code-Points`: 1 チャンクあたりの最大コードポイント（`300`）

## 3. 音色一覧取得 API (`GET /api/voices`)

Microsoft Edge TTS で現在利用可能な音色一覧を返します（6 時間キャッシュ）。

### cURL 実行例

```bash
curl -s http://127.0.0.1:8080/api/voices \
  -H "Authorization: Bearer $API_KEY"
```

## 4. ヘルスチェック API (`GET /health`, `GET /api/health`)

ヘルスチェックは HTTP プロセスの生存のみを確認し、Microsoft 接続や合成の準備完了は確認しません。

返却値: `HTTP/1.1 200 OK`、`{"status":"ok"}`。

## エラーレスポンスとステータスコード

音声ヘッダー送信前のエラーは以下の JSON 形式です。送信開始後のエラーは接続終了になります。200 はダウンロード完了を保証しません。中断した音声を破棄し、明示的に再試行してください。

```json
{ "error": { "code": "INVALID_REQUEST", "message": "Invalid request" } }
```

| HTTP | Code                     | 原因                             |
| ---- | ------------------------ | -------------------------------- |
| 400  | `INVALID_REQUEST`        | リクエスト検証失敗               |
| 401  | `UNAUTHORIZED`           | キーが未指定または不正           |
| 404  | `NOT_FOUND`              | ルートやリソースが存在しない     |
| 429  | `RATE_LIMITED`           | 受付枠の超過                     |
| 413  | `PAYLOAD_TOO_LARGE`      | リクエスト本文が大きすぎる       |
| 415  | `UNSUPPORTED_MEDIA_TYPE` | 非対応の Content-Type            |
| 500  | `INTERNAL_ERROR`         | 内部エラー                       |
| 502  | `UPSTREAM_ERROR`         | 上流接続または合成失敗           |
| 503  | `SERVER_BUSY`            | キュー満杯または 30 秒の待機超過 |

両音声 API はプロセスあたり 12 件/10 秒の枠を共有し、音声一覧は毎分 60 件です。[設定](configuration.ja.md)を参照してください。
