# edgeTTS

[![Release](https://img.shields.io/github/v/release/DejavuMoe/edgeTTS?color=blue)](https://github.com/DejavuMoe/edgeTTS/releases)
[![CI Status](https://img.shields.io/github/actions/workflow/status/DejavuMoe/edgeTTS/ci.yml?branch=main)](https://github.com/DejavuMoe/edgeTTS/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Docker GHCR](https://img.shields.io/badge/docker-GHCR-blue.svg)](https://github.com/DejavuMoe/edgeTTS/pkgs/container/edgetts)
[![Node Version](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](package.json)

[English](README.md) | [简体中文](README.zh-CN.md) | 日本語

edgeTTS は、Microsoft Edge の音声読み上げサービスを活用した高性能なセルフホスト型 Web サービスおよびインタラクティブなワークベンチです。OpenAI 互換の音声合成エンドポイント、最大 20,000 コードポイントの長文に対応したネイティブストリーミング API、およびモダンな WebUI を提供します。

> [!NOTE]
> edgeTTS は Microsoft Edge TTS オンラインサービスを利用しています。アップストリームの可用性や音声カタログはマイクロソフトにより管理されています。edgeTTS は独立したオープンソースプロジェクトであり、マイクロソフト社との提携や推奨関係はありません。

---

## 主な機能

- **デュアル音声合成 API**:
  - **OpenAI 互換エンドポイント** (`POST /v1/audio/speech`): OpenAI TTS の代替としてそのまま利用可能。`tts-1`（48 kbps）および `tts-1-hd`（96 kbps）モデル、Edge 全音色、速度変更（0.5〜2.0）、およびストリーミング配信に対応。
  - **ネイティブ長文ストリーミング API** (`POST /api/speech`): 1 回の HTTP リクエストで最大 20,000 Unicode コードポイントの長文を可逆自動分割してストリーミング配信。詳細な韻律制御（速度、ピッチ半音、音量）および分割メタデータヘッダーを提供。
- **可逆階層的テキスト分割**:
  - Unicode コードポイント精度に基づく境界分割（`段落 > 改行 > 文末記号 > 空白 > 強制切断`）。サロゲートペアや CRLF の原子性を厳格に保持し、チャンクを再結合すると元のテキストが完全に再現されます。
- **公平な並行制御とキュー管理**:
  - インメモリ FIFO リミッター（4 並行ストリーム、16 待機枠）。長文セッションはストリーミング全体で 1 つの実行許可を保持し、再生中の中断を防止します。クライアント切断時は即座にアップストリーム接続を中断します。
- **モダンな Web ワークベンチ**:
  - ブラウザ標準コンポーネントの挙動差を排除した軽量 UI プリミティブ群（`Select`、`Slider`、`Checkbox`、`AudioPlayer`）と、目に優しい「warm-paper」デザインシステム。
  - 地域フィルタリングおよび全文検索に対応した音色カタログ（お気に入りピン留め機能付き）。
  - ローカル UTF-8 `.txt` ファイルのインポート（最大 256 KiB / 20,000 コードポイント、ブラウザ内で完結しサーバーへは保存されません）。
  - `MediaSource` プログレッシブストリーミング再生（Blob への自動フォールバック対応）、シークバー、および MP3 ダウンロード機能。
- **本番運用の堅牢性**:
  - 単一オリジン構成: Fastify がフロントエンド SPA とバックエンド API を単一ポートで配信。
  - プライバシー保護: ユーザー入力テキストのログ記録なし、アクセス解析なし、外部テレメトリなし。
  - 定数時間比較による API キー検証（`Authorization: Bearer <API_KEY>`）。
  - コンテナセキュリティ: 非 root ユーザー `node`、読み取り専用ルートファイルシステム、ケーパビリティ破棄、特権昇格防止。

---

## クイックスタート

### 方法 A: Docker Compose ビルド済みイメージ（推奨）

ディレクトリを作成し、`compose.yaml` を用意します：

```bash
mkdir -p ~/edgetts && cd ~/edgetts
```

```yaml
services:
  edgetts:
    image: ghcr.io/dejavumoe/edgetts:0.3.0
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

ランダムな API キーを生成してサービスを起動します：

```bash
echo "API_KEY=$(openssl rand -hex 32)" > .env
docker compose up -d
```

### 方法 B: 単一 Docker コンテナ実行 (`docker run`)

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
  ghcr.io/dejavumoe/edgetts:0.3.0
```

> [!IMPORTANT]
> **ループバックバインド（`127.0.0.1:8080:8080`）**: `127.0.0.1` にバインドすることで、ポートが公衆網へ直接公開されるのを防ぎます。インターネット経由でアクセスする場合は、前段に HTTPS リバースプロキシ（Nginx や Caddy）を配置してください。

### 動作確認

```bash
curl -i http://127.0.0.1:8080/health
```

期待されるレスポンス: `HTTP/1.1 200 OK`、`{"status":"ok"}`。

ブラウザで `http://127.0.0.1:8080` を開くと Web ワークベンチが表示されます。

---

## API 利用例

### 1. OpenAI 互換音声合成 (`POST /v1/audio/speech`)

```bash
curl -X POST http://127.0.0.1:8080/v1/audio/speech \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tts-1",
    "voice": "ja-JP-NanamiNeural",
    "input": "こんにちは。edgeTTS の音声合成テストです。",
    "response_format": "mp3",
    "speed": 1.0
  }' \
  --output speech.mp3
```

#### Python 公式 OpenAI SDK での呼び出し

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8080/v1",
    api_key="your-secret-api-key",
)

with client.audio.speech.with_streaming_response.create(
    model="tts-1",
    voice="ja-JP-NanamiNeural",
    input="こんにちは！edgeTTS からストリーミング再生を行っています。",
) as response:
    response.stream_to_file("speech.mp3")
```

### 2. ネイティブ長文ストリーミング合成 (`POST /api/speech`)

```bash
curl -X POST http://127.0.0.1:8080/api/speech \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "これは長文ドキュメントの内容です。edgeTTS はサーバー側で可逆分割を行い、単一の HTTP ストリームで全音声を配信します。",
    "voice": "ja-JP-NanamiNeural",
    "quality": "standard",
    "speed": 1.0,
    "pitchSemitones": 0.0,
    "volume": 1.0
  }' \
  --output long-speech.mp3
```

---

## ドキュメント一覧

[`docs/`](docs/) ディレクトリにて詳細なドキュメントを提供しています：

| ドキュメント                                                | 説明                                                                           |
| :---------------------------------------------------------- | :----------------------------------------------------------------------------- |
| [**セルフホストデプロイガイド**](docs/deployment.ja.md)     | Docker Compose、単一コンテナ、ソースビルド、Linux systemd のセットアップ手順。 |
| [**リバースプロキシ & TLS 設定**](docs/reverse-proxy.ja.md) | Nginx・Caddy の設定例、ストリーミング非バッファリング原則、検証スクリプト。    |
| [**設定リファレンスマニュアル**](docs/configuration.ja.md)  | 環境変数一覧、認証仕様、レート制限、並行制御キューの詳細。                     |
| [**API リファレンス & 連携ガイド**](docs/api.ja.md)         | エンドポイント仕様、スキーマ、エラーコード一覧、外部クライアント設定方法。     |
| [**リリースガバナンス & セキュリティ**](docs/releasing.md)  | 厳格な SemVer 方針、OCI 署名検証、不変ダイジェスト固定の仕組み。               |

---

## アーキテクチャ

```text
HTTP ルート (apps/server)
       ↓
  TtsService (packages/tts-service)
       ↓
  TtsProvider (packages/tts-core)
       ↓
EdgeTtsProvider (packages/edge-provider)
       ↓
   msedge-tts (アップストリーム WebSocket)
```

- `apps/server`: Fastify によるサービス統合、HTTP ルーティング、レート制限、静的アセット配信。
- `apps/web`: React + Vite によるモダンな SPA ワークベンチ（自研アクセシブル UI プリミティブ搭載）。
- `packages/tts-service`: プロバイダー非依存のビジネスロジック（音色キャッシュ、並行リミッター、長文可逆分割）。
- `packages/tts-core`: ドメイン層の抽象定義とポート契約。
- `packages/edge-provider`: Microsoft Edge 音声読み上げ WebSocket アダプター。
- `packages/shared`: 共有バリデーションスキーマ、型定義、Unicode テキスト処理ユーティリティ。

---

## ライセンス

本プロジェクトは [MIT License](LICENSE) のもとで公開されています。
