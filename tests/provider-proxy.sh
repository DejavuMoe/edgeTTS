#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
FIXTURE_DIR=$(mktemp -d)
trap 'rm -rf "$FIXTURE_DIR"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' \
  -keyout "$FIXTURE_DIR/key.pem" -out "$FIXTURE_DIR/cert.pem" >/dev/null 2>&1
if [ -z "${1:-}" ]; then
  NODE_EXTRA_CA_CERTS="$FIXTURE_DIR/cert.pem" node tests/provider-proxy.mjs "$FIXTURE_DIR/key.pem" "$FIXTURE_DIR/cert.pem"
else
  # The same deterministic fixture runs against the production dependencies in Bun.
  chmod 755 "$FIXTURE_DIR"
  chmod 644 "$FIXTURE_DIR/key.pem" "$FIXTURE_DIR/cert.pem"
  docker run --rm -i --network none --cap-drop=ALL --security-opt=no-new-privileges \
    --mount "type=bind,src=$FIXTURE_DIR,dst=/fixtures,readonly" \
    -e NODE_EXTRA_CA_CERTS=/fixtures/cert.pem \
    -e EDGETTS_PROVIDER_ENTRY=/app/node_modules/@edgetts/edge-provider/dist/index.js \
    "$1" bun run - /fixtures/key.pem /fixtures/cert.pem < tests/provider-proxy.mjs
fi
