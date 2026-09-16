# セルフホストデプロイガイド

このドキュメントでは、GHCR 公式ビルド済みイメージを使用したスタンドアロン Docker Compose 構成から、単一 Docker コンテナの実行、ソースコードからのビルド、および Linux systemd ネイティブサービスに至るまで、`edgeTTS` の各種セルフホストデプロイ方法を解説します。

`/health` は HTTP プロセスのみを確認し、Microsoft への接続や合成成功を検証しません。リモートサーバーでは HTTPS プロキシの URL でワークベンチを開き、同じキーを入力します。Compose の `.env` はシェルへ自動展開されないため、API 例の実行前にローカル生成ファイルに対して `set -a; . ./.env; set +a` を実行します。再起動や更新時に `.env` を再生成しないでください。

---

## アーキテクチャとセキュリティ原則

本番環境において、`edgeTTS` はリバースプロキシ（Nginx または Caddy）の背後で実行することを推奨します：

```text
クライアント (ブラウザ / クライアントアプリ / API 利用者)
                    │
              HTTPS (ポート 443)
                    ▼
           Nginx / Caddy リバースプロキシ
                    │
           HTTP (127.0.0.1:8080)
                    ▼
           edgeTTS コンテナまたは常駐プロセス
```

- **ループバック隔離（127.0.0.1）**: サービスはホストのループバックアドレスにバインドされ、未保護のポートがパブリックネットワークに直接公開されるのを防止します。
- **TLS 終端**: リバースプロキシが HTTPS 接続と証明書の更新を一元管理します。
- **ストリーミング非バッファリング原則**: 音声合成エンドポイント（`/api/speech` および `/v1/audio/speech`）については、リバースプロキシ側の応答バッファリングを**必ず無効化**（`proxy_buffering off;`）してください。これにより、音声チャンクがクライアントに遅延なく即座に配信されます。

---

## 前提条件

- **コンテナデプロイ**: Docker Engine 24.0+ および Docker Compose v2。
- **ソースビルド / ベアメタル**: Node.js 24 LTS および pnpm 12.3.4。
- **アウトバウンド通信**: Microsoft Edge TTS アップストリームノードへの HTTPS（TCP 443 ポート）外向き接続が必要です。

---

## 方法 1: Docker Compose ビルド済みイメージデプロイ（推奨）

本番環境で最も推奨される、メンテナンスの容易な運用方法です。リポジトリ全体をクローンする必要はなく、GitHub Container Registry (GHCR) から提供されるマルチアーキテクチャイメージを直接使用します。

### 1. 作業ディレクトリの作成

```bash
mkdir -p ~/edgetts && cd ~/edgetts
```

### 2. `compose.yaml` の作成

作業ディレクトリ内に `compose.yaml` ファイルを作成します：

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
    stop_grace_period: 35s
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      - NODE_ENV=production
      - HOST=0.0.0.0
      - PORT=8080
      - API_KEY=${API_KEY:?Set API_KEY in .env}
      - REQUIRE_API_KEY=true
      - SPEECH_RATE_LIMIT_MAX=12
      - SPEECH_RATE_LIMIT_WINDOW_MS=10000
```

> [!NOTE]
> 別のローカルポートにバインドする場合は、`"127.0.0.1:8080:8080"` を `"127.0.0.1:<PORT>:8080"` に変更してください。パブリックネットワークへの意図しない公開を防ぐため、常に `127.0.0.1:` プレフィックスを維持してください。

### 3. API キーの生成と設定

暗号学的に安全なランダム API キー（16 文字以上、空白文字不可）を生成します：

```bash
(umask 077; printf 'API_KEY=%s\n' "$(openssl rand -hex 32)" > .env)
chmod 600 .env
```

### 4. サービスの起動

```bash
docker compose up -d
```

### 5. ヘルスチェックの確認

```bash
curl -i http://127.0.0.1:8080/health
```

期待されるレスポンス: `HTTP/1.1 200 OK`、レスポンスボディ `{"status":"ok"}`。

### コンテナ管理コマンド

```bash
# 実行ステータスの確認
docker compose ps

# ログの確認
docker compose logs -f

# サービスの停止
docker compose stop

# コンテナの停止と削除
docker compose down
```

---

## 方法 2: 単一 Docker コンテナ実行 (`docker run`)

Docker CLI で直接単一コンテナを実行する場合：

### 1. API キーの生成

```bash
export API_KEY="$(openssl rand -hex 32)"
```

### 2. コンテナの起動

```bash
docker run -d \
  --name edgetts \
  --restart unless-stopped \
  --init \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --tmpfs /tmp \
  --stop-timeout 35 \
  -p 127.0.0.1:8080:8080 \
  -e API_KEY="$API_KEY" \
  -e REQUIRE_API_KEY=true \
  ghcr.io/dejavumoe/edgetts:0.4.0
```

### セキュリティパラメータの説明

| パラメータ                         | 説明                                                                 |
| :--------------------------------- | :------------------------------------------------------------------- |
| `-p 127.0.0.1:8080:8080`           | コンテナのポート 8080 をホストのループバックアドレスに厳格にバインド |
| `--read-only`                      | ルートファイルシステムを読み取り専用としてマウントし改ざんを防止     |
| `--cap-drop=ALL`                   | Linux カーネルの全ケーパビリティを破棄し最小権限で実行               |
| `--security-opt=no-new-privileges` | コンテナ内プロセスの権限昇格（setuid 等）を禁止                      |
| `--tmpfs /tmp`                     | 一時データ書き込み用にメモリベースの `/tmp` のみを許可               |
| `--init`                           | 軽量 init プロセス（tini）を使用しゾンビプロセスを確実に回収         |
| `--stop-timeout 35`                | サーバーの 30 秒停止期限と終了余裕を含め、35 秒待機                  |

---

## イメージタグとダイジェストの固定

公式マルチアーキテクチャイメージは `linux/amd64` および `linux/arm64` をネイティブサポートしています。

| タグ                                        | 説明                                         | 推奨用途                     |
| :------------------------------------------ | :------------------------------------------- | :--------------------------- |
| `ghcr.io/dejavumoe/edgetts:0.4.0`           | 厳格な SemVer リリースタグ                   | 本番環境の通常デプロイ       |
| `ghcr.io/dejavumoe/edgetts:latest`          | 公開された最新の安定リリース                 | 自動更新環境                 |
| `ghcr.io/dejavumoe/edgetts:main`            | `main` ブランチの最新ビルドスナップショット  | 最新機能のテスト             |
| `ghcr.io/dejavumoe/edgetts@sha256:<digest>` | コンテンツアドレス指定による不変ダイジェスト | 厳格な再現性を求める本番環境 |

各リリースの検証済み OCI インデックスダイジェストは [GitHub Release ページ](https://github.com/DejavuMoe/edgeTTS/releases) に記載されています。

---

## 方法 3: ソースコードからのビルドと Docker Compose

リポジトリのソースコードからローカルでビルドしてデプロイする場合：

```bash
# 1. リポジトリのクローン
git clone https://github.com/DejavuMoe/edgeTTS.git
cd edgeTTS

# 2. 環境設定ファイルの準備
cp .env.example .env
chmod 600 .env

# 3. API キーの生成と設定
sed -i "s/^# API_KEY=.*/API_KEY=$(openssl rand -hex 32)/" .env

# 4. ビルドと起動
docker compose up -d --build
```

---

## 方法 4: Linux ベアメタル / Systemd サービス

`/opt` へのインストールは root または適切な sudo 権限で実行してください。`command -v node` でパスを確認し、必要に応じて `ExecStart` を変更します。プログラムは root が所有し、サービスのみ `edgetts` で実行します。キーは公開ユニットに書かず、root のみ読み取れる `/etc/edgetts.env` に初回だけ生成し、更新時は保持します。

コンテナ環境を利用しない Linux サーバー向けの構成：

### 1. Node.js & pnpm の確認

Node.js 24 LTS と pnpm 12.3.4 がインストールされていることを確認します：

```bash
node -v # v24.x
pnpm -v # 12.3.4
```

### 2. ソースのビルド

```bash
git clone https://github.com/DejavuMoe/edgeTTS.git /opt/edgetts
cd /opt/edgetts

pnpm install --frozen-lockfile
pnpm build
```

### 3. 専用システムユーザーの作成

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin edgetts
sudo chown -R root:root /opt/edgetts
sudo sh -c 'umask 077; printf "API_KEY=%s\n" "$(openssl rand -hex 32)" > /etc/edgetts.env'
```

### 4. Systemd ユニットファイルの作成

`/etc/systemd/system/edgetts.service` を作成します：

```ini
[Unit]
Description=edgeTTS Speech Synthesis Service
After=network.target

[Service]
Type=simple
User=edgetts
Group=edgetts
WorkingDirectory=/opt/edgetts
ExecStart=/usr/bin/node apps/server/dist/server.js
Restart=on-failure
RestartSec=5s
TimeoutStopSec=35s

# 環境変数
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=8080
Environment=REQUIRE_API_KEY=true
EnvironmentFile=/etc/edgetts.env

# セキュリティサンドボックス
ProtectSystem=strict
ProtectHome=true
NoNewPrivileges=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictNamespaces=true
CapabilityBoundingSet=

[Install]
WantedBy=multi-user.target
```

### 5. サービスの起動と自動起動登録

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now edgetts
sudo systemctl status edgetts
```

---

## アップグレードと保守

最初に `compose.yaml` の `image:` を目的の公開バージョンまたはダイジェストへ変更します。`docker compose pull` は設定された参照だけを取得し、固定された `0.4.0` を別バージョンへ自動更新しません。`.env` と以前のイメージ参照を保持してください。

```bash
cd ~/edgetts
docker compose pull edgetts
docker compose up -d edgetts
curl --fail http://127.0.0.1:8080/health
```

ロールバックは以前のイメージ参照に戻し、同じコマンドを実行します。ソースビルドの場合は目的のリビジョンに切り替えて `docker compose up -d --build` を実行します。単一インスタンスの交換中は新規接続が一時停止し、進行中の音声もサーバーの 30 秒停止期限で切断される場合があります。無停止やミリ秒での更新は保証しません。
