# リバースプロキシ設定ガイド

このドキュメントでは、本番環境で `edgeTTS` の前段に Nginx または Caddy リバースプロキシを構成する方法を解説します。

---

## 構成トポロジと設計原則

```text
クライアント (ブラウザ / クライアントアプリ / OpenAI クライアント)
                    │
              HTTPS (ポート 443)
                    ▼
           リバースプロキシ (Nginx / Caddy)
                    │
           HTTP (127.0.0.1:8080)
                    ▼
           edgeTTS コンテナまたは常駐プロセス
```

1. **ループバック隔離**: edgeTTS はホストの `127.0.0.1` のみにバインドし、未暗号化または未保護のポートを直接公衆網に公開しません。
2. **TLS 終端**: リバースプロキシが SSL/TLS 証明書を管理し、HTTPS 通信を暗号化します。
3. **ストリーミング非バッファリング原則（最重要）**: 音声合成エンドポイント（`/api/speech` および `/v1/audio/speech`）では、**プロキシ側の応答バッファリングを必ず無効化**してください。Microsoft Edge TTS は音声をチャンク単位で順次合成します。プロキシ側でバッファリングが有効になっていると、全文の合成が完了するかバッファが満杯になるまでクライアントに音声が届かず、長時間の無音状態が発生します。
4. **ヘッダーの透過**: クライアントの `Host`、`X-Real-IP`、`X-Forwarded-For`、`X-Forwarded-Proto`、および `Authorization: Bearer <API_KEY>` をそのまま edgeTTS に転送する必要があります。

---

## Nginx の設定

リポジトリ内の [`deploy/nginx/edgetts.conf.example`](../deploy/nginx/edgetts.conf.example) に検証済みのテンプレートが用意されています。

### 設定テンプレート

```nginx
upstream edgetts_backend {
    server 127.0.0.1:8080;
    keepalive 16;
}

# HTTP から HTTPS へのリダイレクト
server {
    listen 80;
    listen [::]:80;
    server_name edgetts.example.com;

    server_tokens off;
    return 301 https://$host$request_uri;
}

# 本番 HTTPS サーバー
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name edgetts.example.com;

    server_tokens off;
    client_max_body_size 1m;

    # 証明書パス（実際のパスに書き換えてください）
    ssl_certificate /etc/letsencrypt/live/edgetts.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/edgetts.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # セキュリティヘッダー
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "same-origin" always;
    proxy_hide_header X-Frame-Options;
    add_header X-Frame-Options "SAMEORIGIN" always;

    # ネイティブストリーミング音声合成 - バッファリング無効
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

    # OpenAI 互換ストリーミング音声合成 - バッファリング無効
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

    # 一般アプリケーションルーティング（WebUI、静的ファイル、音色一覧、ヘルスチェック）
    location / {
        proxy_pass http://edgetts_backend;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 反映手順（Ubuntu / Debian）

```bash
# 1. 設定ファイルのコピー
sudo cp deploy/nginx/edgetts.conf.example /etc/nginx/sites-available/edgetts.conf

# 2. ドメインおよび証明書パスの編集
sudo nano /etc/nginx/sites-available/edgetts.conf

# 3. 有効化
sudo ln -s /etc/nginx/sites-available/edgetts.conf /etc/nginx/sites-enabled/edgetts.conf

# 4. 構文テスト
sudo nginx -t

# 5. リロード
sudo systemctl reload nginx
```

---

## Caddy の設定

Caddy では自動 HTTPS 機能により、証明書取得・更新を含めて極めてシンプルな構成が可能です。

### `Caddyfile` の設定例

```caddyfile
edgetts.example.com {
    encode zstd gzip

    # 音声ストリーミング - 受信チャンクを即座にフラッシュ
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

    # デフォルトハンドラ
    handle {
        reverse_proxy 127.0.0.1:8080
    }
}
```

> [!TIP]
> `flush_interval -1` を設定すると、Caddy は edgeTTS から受信した音声チャンクをバッファリングせず即座にクライアントへフラッシュします。

---

## 本番公開前チェックリスト

1. **初期再生レイテンシ**: 音声リクエスト送信後、全文生成完了を待つことなく 0.5〜1.5 秒程度で再生が開始されるか確認してください。
2. **認証ヘッダーの透過**: `Authorization: Bearer <API_KEY>` を含むリクエストが正常に通過し、不正キーで 401 が返ることを確認してください。
3. **エラーレスポンスの保持**: アプリケーションのエラー JSON（400、401、429、502、503）がプロキシに置き換えられずそのまま届くことを確認してください。
4. **ヘルスチェック**: `GET /health` で `200` および `{"status":"ok"}` が返ることを確認してください。
