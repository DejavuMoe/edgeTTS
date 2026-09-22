# リバースプロキシ設定ガイド

このドキュメントでは、本番環境で `edgeTTS` の前段に Nginx または Caddy リバースプロキシを構成する方法を解説します。

この例はホスト上のプロキシを前提とします。プロキシもコンテナの場合、`127.0.0.1` はそのコンテナ自身です。両サービスをプライベート Docker ネットワークに接続し `edgetts:8080` を指定します。Nginx 例は証明書が既に存在する前提です。`nginx -t` の前に取得してください。検証スクリプトは Docker が必要で、上流のライブ検証を無効にしてもイメージ取得にネットワークが必要な場合があります。

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
4. **ヘッダー**: `Authorization` を保持し、転送ヘッダーはプロキシで設定します。転送 IP は認証済みクライアントの識別や個別の配分には使用しません。

## Nginx の設定

[リポジトリの Nginx テンプレート](../deploy/nginx/edgetts.conf.example)を使用し、ドメインと証明書パスを置換して有効化します。両音声ルートの応答バッファリングとキャッシュは無効のままにします。

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

## 本番公開前チェックリスト

1. **初期再生レイテンシ**: 音声チャンクがプロキシ経由で順次届くことを確認してください。開始時間は上流、待機キューとブラウザーに依存し、固定値は保証しません。
2. **認証ヘッダーの透過**: `Authorization: Bearer <API_KEY>` を含むリクエストが正常に通過し、不正キーで 401 が返ることを確認してください。
3. **エラーレスポンスの保持**: アプリケーションのエラー JSON（400、401、429、502、503）がプロキシに置き換えられずそのまま届くことを確認してください。
4. **ヘルスチェック**: `GET /health` で `200` および `{"status":"ok"}` が返ることを確認してください。
