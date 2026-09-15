# edgeTTS

[English](README.md) | [简体中文](README.zh-CN.md) | 日本語

edgeTTS は、Microsoft Edge TTS（Edge 音声読み上げ機能）を基盤としたセルフホスト対応の Web アプリケーションおよびストリーミング HTTP 音声合成サービスです。

直感的な Web ワークベンチ、長文向けネイティブ分割音声 API、OpenAI 互換 TTS エンドポイントのサブセット、および本番環境向けのコンテナデプロイ環境を提供します。

> [!NOTE]
> edgeTTS は Microsoft Edge TTS アップストリームサービスに依存しています。アップストリームの可用性、利用可能なボイス、動作仕様は本プロジェクトの管理対象外です。edgeTTS は独立したオープンソースプロジェクトであり、Microsoft による承認や後援を受けたものではありません。

現在の安定版リリース：[v0.3.0](https://github.com/DejavuMoe/edgeTTS/releases/tag/v0.3.0)

---

## 主な機能

- **デュアル音声合成 API**：
  - **OpenAI 互換 TTS サブセット**（`POST /v1/audio/speech`）：OpenAI TTS クライアントから呼び出し可能。`tts-1`（`mp3-48k`）および `tts-1-hd`（`mp3-96k`）モデル、Edge ボイス ID、1〜4,096 文字のテキスト入力、0.5〜2.0 の速度調整に対応。
  - **ネイティブ長文ストリーミング API**（`POST /api/speech`）：単一の HTTP 接続で最大 20,000 Unicode コードポイントの長文合成に対応。標準品質（`mp3-48k`）および高品質（`mp3-96k`）、詳細な韻律制御（速度、音調半音、音量）、レスポンスヘッダーでの決定論的分割メタデータを提供。
- **可逆テキスト分割**：
  - 階層境界分割（`段落 > 改行 > 文末句読点 > 空白 > 強制分割`）を採用し、サロゲートペアや CRLF の原子性を保ちながら Unicode コードポイント単位で正確に計算。
  - 分割されたチャンクを結合することで、元の入力テキストを変異や自動トリミングなしに完全復元可能。
- **公平な同時実行制御**：
  - インメモリ FIFO キュー制限機構（アクティブな同時実行 4 ストリーム、待機キュー 16 スロット）。
  - 長文分割合成は順序付きストリーム全体で 1 つの実行許可を保持し、ストリーム途中のキュー競合を防ぎつつ上流セッション数を制限。
  - クライアントが切断された場合、キュー内のリクエストおよびアクティブな合成ストリームを即座に中断。
- **Web ワークベンチ**：
  - React SPA によるデュアルモード再生：`MediaSource` によるプログレッシブストリーミング再生を優先し、非対応ブラウザでは Blob オブジェクト URL へ自動フォールバック。
  - ボイスの検索、言語・地域フィルター、お気に入り登録機能。
  - ローカル UTF-8 `.txt` ファイルのインポート（ブラウザローカルで読み込み、上限 256 KiB / 20,000 コードポイント。インポート時はアップロードも保存もしませんが、合成時のテキストは設定済みサービスと Microsoft Edge TTS 上流へ送信されます）。
  - キーボードショートカット：`Ctrl+Enter` / `Cmd+Enter` で合成開始、`Escape` で合成中止。
  - リアルタイムテキスト統計とストリーミングテレメトリ表示（リクエスト中状態、ストリーミング再生状態、計画分割セグメント数、実際の受信済み音声バイト数）。
- **同一オリジン静的ホスティング**：
  - Fastify サーバーがビルド済みフロントエンド静的アセット（`apps/web/dist`）と API を同一ポート・ドメインでホスト。
  - ハッシュ化アセットの長期キャッシュ、`index.html` の再検証キャッシュ、および安全な SPA フォールバックルーティング。
- **セキュリティとプライバシー**：
  - 合成入力テキストのログ記録、分析データの収集、外部テレメトリ送信は行いません。入力テキストや認証情報はディスクに永続化されません。
  - `Authorization: Bearer <API_KEY>` ヘッダーによる任意の API キー認証（一定時間比較によるタイミング攻撃対策済み）。
  - 本番コンテナの堅牢化：非 root ユーザー（`node`）、読み取り専用ルートファイルシステム、Linux Capabilities の全破棄（`ALL`）、特権昇格の無効化。

---

## クイックスタート（推奨 Docker イメージ）

GitHub Container Registry (GHCR) から公式のビルド済みマルチアーキテクチャコンテナイメージを利用するのが最も簡単で推奨される方法です。

### 1. API キーの生成

```bash
openssl rand -hex 32
```

### 2. コンテナの起動

```bash
export EDGETTS_API_KEY='<生成したキー>'

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
  ghcr.io/dejavumoe/edgetts:0.3.0
```

### 3. 動作確認

```bash
curl http://127.0.0.1:8080/health
```

期待されるレスポンス：

```json
{ "status": "ok" }
```

ブラウザで `http://127.0.0.1:8080` を開くと Web ワークベンチにアクセスできます。

> [!IMPORTANT]
> **ループバックバインド（`127.0.0.1:8080:8080`）**：`127.0.0.1` にバインドすることで、edgeTTS が直接インターネットに公開されるのを防ぎます。インターネット経由で公開する場合は、前段に Nginx などの HTTPS リバースプロキシを配置して TLS 終端を行ってください。

### コンテナイメージのタグとダイジェスト

| 参照形式                                            | 用途                                                  | 変更可能性                         |
| --------------------------------------------------- | ----------------------------------------------------- | ---------------------------------- |
| `ghcr.io/dejavumoe/edgetts:0.3.0`                   | 通常の安定版本番デプロイに推奨                        | リリースタグ                       |
| `ghcr.io/dejavumoe/edgetts@sha256:<release-digest>` | 厳格な再現性を保証するイミュータブル指定              | コンテンツアドレス指定（完全不変） |
| `ghcr.io/dejavumoe/edgetts:latest`                  | 公開済みの最も新しい安定版 SemVer を追跡              | 移動可能タグ                       |
| `ghcr.io/dejavumoe/edgetts:main`                    | `main` ブランチから検証済みの最新開発スナップショット | フローティング                     |

イミュータブルな本番デプロイの固定には `ghcr.io/dejavumoe/edgetts@sha256:<release-digest>` を使用してください。各安定版の検証済みダイジェストは [GitHub Release ノート](https://github.com/DejavuMoe/edgeTTS/releases)に記録されます。

---

## インストールとデプロイ手順

### 方法 1：ビルド済み Docker イメージ（GHCR）

上記の [クイックスタート](#クイックスタート推奨-docker-イメージ) を参照してください。

### 方法 2：Docker Compose（ソースからローカルビルド）

リポジトリ内の `compose.yaml` は、GHCR イメージを pull するのではなく、ローカルのソースコードからコンテナをビルド（`build: context: .`）するように設定されています。

```bash
git clone https://github.com/DejavuMoe/edgeTTS.git
cd edgeTTS

cp .env.example .env
```

安全な API キーを生成します：

```bash
openssl rand -hex 32
```

`.env` ファイルを編集して設定します：

```env
API_KEY=生成したシークレット文字列
REQUIRE_API_KEY=true
EDGETTS_BIND_ADDRESS=127.0.0.1
EDGETTS_HOST_PORT=8080
```

サービスを起動します：

```bash
docker compose up -d --build
```

コンテナの管理：

```bash
# 状態確認
docker compose ps

# ログ表示
docker compose logs -f edgetts

# ヘルスチェック
curl http://127.0.0.1:8080/health

# 停止と削除
docker compose down
```

### 方法 3：ソースコードから本番ビルド・実行（Node.js と pnpm）

#### 前提要件

- **Node.js**: `24` LTS
- **pnpm**: `12.3.4`（ルートの `package.json` 内 `packageManager` と一致）

#### ビルドと起動

```bash
git clone https://github.com/DejavuMoe/edgeTTS.git
cd edgeTTS

# 依存関係をインストールし、すべてのパッケージとフロントエンドをビルド
pnpm install --frozen-lockfile
pnpm build

# シークレットの生成
export API_KEY="$(openssl rand -hex 32)"

# 本番サーバーの起動
NODE_ENV=production \
HOST=127.0.0.1 \
PORT=8080 \
API_KEY="$API_KEY" \
REQUIRE_API_KEY=true \
node apps/server/dist/server.js
```

> [!NOTE]
> Node.js を直接実行する場合、`HOST` のデフォルトは `127.0.0.1`、`REQUIRE_API_KEY` のデフォルトは `false` です。本番環境では必ず明示的に `REQUIRE_API_KEY=true` を指定し、`API_KEY` を設定してください。

### 方法 4：ローカル開発モード

Fastify API サーバーと Vite 開発サーバーをホットリロード有効で同時起動します：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

- **バックエンド API**：`http://127.0.0.1:8080`
- **Vite ワークベンチ**：`http://localhost:5173`（`/api` および `/v1` を 8080 ポートへプロキシ）

---

## 本番リバースプロキシ設定 (Nginx)

インターネット公開環境では、Nginx で TLS を終端し、`127.0.0.1:8080` にバインドされた edgeTTS へ転送します：

```text
インターネット（ブラウザ / 外部 API クライアント）
                      │
               HTTPS (ポート 443)
                      ▼
              Nginx リバースプロキシ
                      │
            HTTP/1.1 (127.0.0.1:8080)
                      ▼
               edgeTTS サービス
```

### デプロイ手順（Debian / Ubuntu）

```bash
# 1. 設定テンプレートのコピー
sudo cp deploy/nginx/edgetts.conf.example /etc/nginx/sites-available/edgetts.conf
sudo ln -s /etc/nginx/sites-available/edgetts.conf /etc/nginx/sites-enabled/edgetts.conf

# 2. ドメイン名および TLS 証明書パスの編集
sudo nano /etc/nginx/sites-available/edgetts.conf

# 3. Nginx 構文のテスト
sudo nginx -t

# 4. Nginx の安全なリロード
sudo systemctl reload nginx
```

### 音声ストリーミングにおける重要なプロキシ設定

`deploy/nginx/edgetts.conf.example` では、音声ストリーミングエンドポイントに対して**明示的に**レスポンスバッファリングが無効化されています：

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
> 全体設定やルートパス（`location /`）でグローバルに `proxy_buffering off;` を設定しないでください。フロントエンド静的アセットや通常の API レスポンスでは配信効率を保つためにデフォルトのバッファリングを維持し、`/api/speech` と `/v1/audio/speech` のみで無効化します。

詳細および自動テスト検証については [`deploy/nginx/README.md`](deploy/nginx/README.md) を参照してください。他のリバースプロキシを使用する場合でも、`Authorization` ヘッダーをそのまま透過し、ストリーミングレスポンスをバッファリングしない設定であれば利用可能です。

---

## 認証仕様

認証を有効化した場合（`REQUIRE_API_KEY=true`）、すべての保護されたリクエストは HTTP ヘッダーに Bearer トークンを含める必要があります：

```http
Authorization: Bearer <API_KEY>
```

- **URL クエリパラメータによる認証は非対応です**（`?api_key=` や `?token=` には対応していません）。
- **認証不要な公開エンドポイント**：`GET /health`、`GET /api/health`、およびフロントエンドワークベンチ（`GET /`）。
- **認証が必要な保護エンドポイント**：`GET /api/voices`、`POST /api/speech`、および `POST /v1/audio/speech`。
- キーの検証には一定時間比較関数（`crypto.timingSafeEqual`）を使用し、タイミング攻撃を防止しています。API キーは 16 文字以上かつ空白を含まない文字列である必要があります。
- **Web ワークベンチの API キー保持動作**：ワークベンチの設定で入力した API キーはブラウザのメモリ内（React ステート）にのみ保持され、`localStorage`、`sessionStorage`、Cookie、URL などには一切保存されません。ページを更新した場合は再入力が必要です。

---

## Web ワークベンチ機能

統合された Web ワークベンチにより、ブラウザから簡単に音声合成を実行できます：

- **ボイス検索・フィルター**：ボイス名、ID、言語・地域による即時絞り込み検索。お気に入り登録機能（ブラウザストレージに保存）、ページ再読み込み時の一貫したボイス選択状態維持。
- **詳細な韻律制御**：`速度`（0.5〜2.0）、`音調`（-12〜+12 半音）、`音量`（0〜1）の微調整。
- **音質切り替え**：標準品質（`mp3-48k`）と高品質（`mp3-96k`）の選択。
- **ローカル UTF-8 TXT インポート**：最大 256 KiB かつ 20,000 Unicode コードポイント以下のローカル `.txt` ファイルを直接読み込み。ブラウザ上で `TextDecoder('utf-8', { fatal: true })` によりデコードされ、サーバーへのファイルアップロードやディスク保存は一切行われません。
- **キーボードショートカット**：`Ctrl+Enter`（Windows/Linux）または `Cmd+Enter`（macOS）で合成開始、`Escape` で合成中断。
- **デュアルモード再生**：`MediaSource` および `SourceBuffer` を用いたプログレッシブ受信再生。非対応環境では自動的に Blob URL 再生へ切り替わります。合成完了後はワンクリックで命名規則に従った MP3 ファイルをダウンロード可能。
- **リアルタイムストリーミングテレメトリ**：ステータス表示（リクエスト中、ストリーミング再生中、サーバー計画セグメント数、実際の受信済み音声バイト数）。不正確な進捗パーセンテージ、到着予想時間 (ETA)、完了セグメントカウンターなどの不確定な値は表示しません。

---

## API リファレンス

### エンドポイント一覧

| メソッド | パス               | 認証要否         | 説明                                                                |
| -------- | ------------------ | ---------------- | ------------------------------------------------------------------- |
| `GET`    | `/health`          | 不要             | 基本ヘルスチェック（`{"status":"ok"}` を返却）                      |
| `GET`    | `/api/health`      | 不要             | `/api` プレフィックス付きヘルスチェック（`{"status":"ok"}` を返却） |
| `GET`    | `/api/voices`      | 認証有効時は必須 | キャッシュされた利用可能な Edge TTS ボイス一覧を取得                |
| `POST`   | `/v1/audio/speech` | 認証有効時は必須 | OpenAI 互換ストリーミング TTS サブセットエンドポイント              |
| `POST`   | `/api/speech`      | 認証有効時は必須 | ネイティブ長文分割ストリーミング音声合成 API                        |

### 1. OpenAI 互換 TTS エンドポイント (`POST /v1/audio/speech`)

OpenAI TTS クライアント向け互換サブセット。MP3 音声をストリーミングで返却します。

#### リクエストパラメータ

- `model`（文字列、必須）：`"tts-1"`（`mp3-48k` にマッピング）または `"tts-1-hd"`（`mp3-96k` にマッピング）。
- `voice`（文字列、必須）：Edge TTS ボイス ID（例：`zh-CN-XiaoxiaoNeural`、`en-US-JennyNeural`）。
- `input`（文字列、必須）：合成対象テキスト（1〜4,096 文字）。
- `response_format`（文字列、任意）：`"mp3"` のみ対応（デフォルト：`"mp3"`）。
- `speed`（数値、任意）：再生速度倍率 `0.5`〜`2.0`（デフォルト：`1.0`）。

#### リクエスト例

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

_(API キー認証を無効化している場合は `Authorization` ヘッダーを省略してください)_

### 2. ネイティブ長文ストリーミング音声 API (`POST /api/speech`)

最大 20,000 Unicode コードポイントのテキスト入力に対応。サーバー側で可逆セマンティック分割を行い、単一の HTTP 接続で連続ストリーミング配信します。

#### リクエストパラメータ

- `input`（文字列、必須）：合成対象テキスト（1〜20,000 Unicode コードポイント）。
- `voice`（文字列、必須）：Edge TTS ボイス ID。
- `quality`（文字列、任意）：`"standard"`（`mp3-48k`、デフォルト）または `"high"`（`mp3-96k`）。
- `speed`（数値、任意）：速度倍率 `0.5`〜`2.0`（デフォルト：`1.0`）。
- `pitchSemitones`（数値、任意）：音調変更半音数 `-12.0`〜`12.0`（デフォルト：`0.0`）。
- `volume`（数値、任意）：音量スケール `0.0`〜`1.0`（デフォルト：`1.0`）。

#### レスポンスヘッダー

正常終了時、分割計画に関するメタデータヘッダーが付与されます：

- `X-EdgeTTS-Segment-Count`：計画された合計セグメント数。
- `X-EdgeTTS-Segment-Max-Code-Points`：セグメントあたりの最大コードポイント上限（`300`）。

#### リクエスト例

```bash
curl -X POST http://127.0.0.1:8080/api/speech \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "これは長文のサンプルテキストです。サーバー側で可逆分割が行われ、単一の接続でストリーミング音声が返却されます。",
    "voice": "zh-CN-XiaoxiaoNeural",
    "quality": "standard",
    "speed": 1.0,
    "pitchSemitones": 0.0,
    "volume": 1.0
  }' \
  --output long-speech.mp3
```

---

## 設定パラメータ一覧

### Fastify サーバー実行時環境変数

バックエンドサーバー（`apps/server`）の動作を設定します：

| 変数名                        | 説明                                                      | 設定可能値                          | デフォルト値                                             |
| ----------------------------- | --------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------- |
| `HOST`                        | HTTP サーバーがリッスンするアドレス                       | IPv4 / IPv6 アドレス                | `127.0.0.1`（Node 直接実行時）、`0.0.0.0`（Docker 内）   |
| `PORT`                        | HTTP サーバーがリッスンするポート                         | ポート番号整数（1〜65535）          | `8080`                                                   |
| `NODE_ENV`                    | アプリケーションの動作モード                              | `production`、`development`、`test` | `undefined`                                              |
| `API_KEY`                     | Bearer 認証に使用するシークレットキー                     | 文字列（16 文字以上、空白不可）     | 未設定                                                   |
| `REQUIRE_API_KEY`             | API キー検証を必須とするかどうか                          | `true` または `false`               | `false`（Node 直接実行時）、`true`（Compose デフォルト） |
| `SPEECH_RATE_LIMIT_MAX`       | ウィンドウ時間内に許可する最大音声合成リクエスト数        | `1`〜`10000` の整数                 | `12`                                                     |
| `SPEECH_RATE_LIMIT_WINDOW_MS` | レート制限のウィンドウ時間（ミリ秒）                      | `100`〜`3600000` の整数             | `10000`（10 秒）                                         |
| `SERVE_STATIC`                | Fastify によるフロントエンド SPA 静的ホスティングを有効化 | `true` または `false`               | `NODE_ENV=production` の場合に自動有効化                 |
| `WEB_DIST_DIR`                | 静的フロントエンドアセットのビルド出力先ディレクトリ      | ディレクトリパス                    | 相対パス `apps/web/dist`                                 |

### Docker Compose ホスト側環境変数（`.env`）

`compose.yaml` におけるホスト側のポートマッピングとバインドを設定します：

| 変数名                 | 説明                                                 | デフォルト値 |
| ---------------------- | ---------------------------------------------------- | ------------ |
| `EDGETTS_BIND_ADDRESS` | ホスト側でコンテナポートをバインドする IP アドレス   | `127.0.0.1`  |
| `EDGETTS_HOST_PORT`    | コンテナの 8080 ポートへマッピングするホスト側ポート | `8080`       |

### 内蔵制限値（プロセス内インメモリ）

- **音声合成リクエストレート制限**：`/v1/audio/speech` および `/api/speech` 全体で 10 秒間に合計 12 リクエストまで（超過時は HTTP 429）。
- **同時実行制限**：同時に実行できるストリーム数は最大 4、待機キューは最大 16（長文分割セッションは完了またはキャンセルまで 1 つの許可を保持し、キュー満杯時は HTTP 503）。

---

## コンテナアーキテクチャとセキュリティ

公式 GHCR イメージはマルチアーキテクチャ（`linux/amd64` および `linux/arm64`）に対応しており、暗号論的に検証可能なサプライチェーン証明情報（SLSA provenance および SPDX SBOM）が添付されています。

### セキュリティ堅牢化対策

- **非 root ユーザー実行**：コンテナは非特権ユーザー `node`（UID/GID 1000:1000）で実行されます。
- **読み取り専用ルートファイルシステム**：`--read-only` または Compose の `read_only: true` で保護。
- **全 Capabilities 破棄**：すべての Linux Capabilities を破棄（`--cap-drop=ALL`）。
- **特権昇格禁止**：`no-new-privileges:true` を適用。
- **一時ストレージの最小化**：書き込み可能な領域は `/tmp`（`tmpfs`）のみに限定。
- **Init プロセス**：`--init` によりゾンビプロセスの適切な回収とシグナル転送を実施。
- **グレースフルシャットダウン**：30 秒の停止猶予（`--stop-timeout 30`）により実行中の合成ストリームを安全に完了。

---

## リポジトリ構成

```text
HTTP リクエスト (apps/server)
       ↓
  TtsService (packages/tts-service)
       ↓
  TtsProvider (packages/tts-core)
       ↓
EdgeTtsProvider (packages/edge-provider)
       ↓
   msedge-tts
```

- `apps/server`：Fastify HTTP サーバーおよびコンポジションルート（`@edgetts/server`）。
- `apps/web`：React + Vite フロントエンドワークベンチアプリケーション（`@edgetts/web`）。
- `packages/shared`：共通スキーマ、型定義、Unicode ユーティリティ（`@edgetts/shared`）。
- `packages/tts-core`：ドメインインターフェースと型定義（`@edgetts/tts-core`）。
- `packages/edge-provider`：Microsoft Edge 音声読み上げプロバイダーアダプター（`@edgetts/edge-provider`）。
- `packages/tts-service`：ボイスキャッシュ、同時実行制限、テキスト分割サービス（`@edgetts/tts-service`）。

---

## 関連ドキュメント

- [Nginx 本番リバースプロキシデプロイガイド](deploy/nginx/README.md)
- [リリースガバナンスとロールバック手順](docs/releasing.md)
- [GitHub Release v0.3.0](https://github.com/DejavuMoe/edgeTTS/releases/tag/v0.3.0)
- [MIT ライセンス](LICENSE)

---

## ライセンス

本プロジェクトは [MIT ライセンス](LICENSE) の下で公開されています。
