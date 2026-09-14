#!/usr/bin/env bash
# Integration test suite for EdgeTTS Nginx reverse-proxy contract.
# Validates syntax, deterministic chunk streaming, error preservation,
# authentication passthrough, and one live speech synthesis request.

set -euo pipefail

NGINX_IMAGE="nginx:1.27.4-alpine-slim"
EDGETTS_IMAGE="${EDGETTS_TEST_IMAGE:-edgetts:phase15-1}"
TEST_API_KEY="test-nginx-api-key-1234567890"
TEST_PORT="18082"
TMP_DIR="$(mktemp -d -t edgetts-nginx-test-XXXXXX)"

MOCK_CONTAINER="edgetts-test-mock-upstream"
MOCK_NGINX_CONTAINER="edgetts-test-mock-nginx"
REAL_BACKEND_CONTAINER="edgetts-test-real-backend"
REAL_NGINX_CONTAINER="edgetts-test-real-nginx"

cleanup() {
  local exit_code=$?
  echo "==> Cleaning up test containers and artifacts..."
  docker rm -f "$MOCK_CONTAINER" "$MOCK_NGINX_CONTAINER" "$REAL_BACKEND_CONTAINER" "$REAL_NGINX_CONTAINER" 2>/dev/null || true
  rm -rf "$TMP_DIR"
  rm -f /tmp/edgetts-nginx-test-*.mp3 /tmp/edgetts-stream-*.tmp 2>/dev/null || true
  echo "==> Cleanup complete (exit code: $exit_code)."
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

echo "============================================================"
echo "Phase 16: Nginx Reverse Proxy Automated Verification Suite"
echo "Nginx Image:   $NGINX_IMAGE"
echo "EdgeTTS Image: $EDGETTS_IMAGE"
echo "Tmp Directory: $TMP_DIR"
echo "============================================================"

# ------------------------------------------------------------
# 1. Static Configuration Audit
# ------------------------------------------------------------
echo ""
echo "--- [1/5] Auditing deploy/nginx/edgetts.conf.example ---"
CONF_EXAMPLE="deploy/nginx/edgetts.conf.example"

if [ ! -f "$CONF_EXAMPLE" ]; then
  echo "FAIL: $CONF_EXAMPLE does not exist!"
  exit 1
fi

grep -q "server 127.0.0.1:8080;" "$CONF_EXAMPLE" || { echo "FAIL: upstream missing 127.0.0.1:8080"; exit 1; }
grep -q "keepalive 16;" "$CONF_EXAMPLE" || { echo "FAIL: upstream missing keepalive 16"; exit 1; }
grep -q "location = /api/speech" "$CONF_EXAMPLE" || { echo "FAIL: missing exact location = /api/speech"; exit 1; }
grep -q "location = /v1/audio/speech" "$CONF_EXAMPLE" || { echo "FAIL: missing exact location = /v1/audio/speech"; exit 1; }
grep -q "proxy_buffering off;" "$CONF_EXAMPLE" || { echo "FAIL: missing proxy_buffering off"; exit 1; }
grep -q "proxy_cache off;" "$CONF_EXAMPLE" || { echo "FAIL: missing proxy_cache off"; exit 1; }
grep -q "proxy_read_timeout 300s;" "$CONF_EXAMPLE" || { echo "FAIL: missing proxy_read_timeout 300s"; exit 1; }
grep -q "client_max_body_size 1m;" "$CONF_EXAMPLE" || { echo "FAIL: missing client_max_body_size 1m"; exit 1; }
grep -q "server_tokens off;" "$CONF_EXAMPLE" || { echo "FAIL: missing server_tokens off"; exit 1; }

# Disallowed configurations
if grep -q "proxy_ignore_client_abort" "$CONF_EXAMPLE"; then
  echo "FAIL: proxy_ignore_client_abort must not be set"
  exit 1
fi
if grep -q "proxy_intercept_errors" "$CONF_EXAMPLE"; then
  echo "FAIL: proxy_intercept_errors must not be set"
  exit 1
fi
if grep -i "upgrade" "$CONF_EXAMPLE"; then
  echo "FAIL: WebSocket upgrade directives must not be present"
  exit 1
fi
if grep -i "strict-transport-security" "$CONF_EXAMPLE"; then
  echo "FAIL: HSTS must not be set"
  exit 1
fi
if grep -i "content-security-policy" "$CONF_EXAMPLE"; then
  echo "FAIL: CSP must not be set"
  exit 1
fi
if grep -i "api_key" "$CONF_EXAMPLE"; then
  echo "FAIL: API_KEY must not be embedded in Nginx config"
  exit 1
fi
if grep -q "proxy_set_header.*Authorization" "$CONF_EXAMPLE"; then
  echo "FAIL: Authorization header must not be explicitly rewritten"
  exit 1
fi
echo "PASS: Static configuration audit passed."

# ------------------------------------------------------------
# 2. Containerized Syntax Validation (nginx -t)
# ------------------------------------------------------------
echo ""
echo "--- [2/5] Containerized Syntax Validation (nginx -t) ---"
openssl req -x509 -nodes -days 1 -newkey rsa:2048 \
  -keyout "$TMP_DIR/privkey.pem" \
  -out "$TMP_DIR/fullchain.pem" \
  -subj "/CN=edgetts.example.com" 2>/dev/null

sed -e "s|/path/to/fullchain.pem|$TMP_DIR/fullchain.pem|g" \
    -e "s|/path/to/privkey.pem|$TMP_DIR/privkey.pem|g" \
    "$CONF_EXAMPLE" > "$TMP_DIR/edgetts-syntax.conf"

SYNTAX_OUTPUT=$(docker run --rm \
  -v "$TMP_DIR:$TMP_DIR:ro" \
  -v "$TMP_DIR/edgetts-syntax.conf:/etc/nginx/conf.d/edgetts.conf:ro" \
  "$NGINX_IMAGE" nginx -t 2>&1)

echo "$SYNTAX_OUTPUT" | grep -q "syntax is ok" || { echo "FAIL: nginx -t syntax not ok"; echo "$SYNTAX_OUTPUT"; exit 1; }
echo "$SYNTAX_OUTPUT" | grep -q "test is successful" || { echo "FAIL: nginx -t test not successful"; echo "$SYNTAX_OUTPUT"; exit 1; }
echo "PASS: nginx -t validated successfully on $NGINX_IMAGE."

# ------------------------------------------------------------
# 3. Deterministic Streaming and Status Preservation
# ------------------------------------------------------------
echo ""
echo "--- [3/5] Deterministic Streaming & Error Preservation ---"
cat << 'EOF' > "$TMP_DIR/mock-upstream.mjs"
import http from 'node:http';

let releaseWaiters = [];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (url.pathname === '/api/speech' || url.pathname === '/v1/audio/speech') {
    req.resume();
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Transfer-Encoding': 'chunked',
    });
    // Send first chunk immediately
    res.write('CHUNK1_DETERMINISTIC_STREAMING_DATA\n');

    // Block until explicit release trigger
    await new Promise((resolve) => {
      releaseWaiters.push(resolve);
    });

    // Send second chunk upon release
    res.write('CHUNK2_DETERMINISTIC_STREAMING_DATA\n');
    res.end();
    return;
  }

  if (url.pathname === '/release') {
    const waiters = releaseWaiters;
    releaseWaiters = [];
    waiters.forEach((resolve) => resolve());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ released: true, count: waiters.length }));
    return;
  }

  if (url.pathname === '/mock-400') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'INVALID_REQUEST', message: 'Deterministic 400 test' } }));
    return;
  }

  if (url.pathname === '/mock-503') {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Deterministic 503 test' } }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { code: 'NOT_FOUND' } }));
});

server.listen(8080, '0.0.0.0', () => {
  console.log('Mock upstream ready on port 8080');
});
EOF

docker run -d --name "$MOCK_CONTAINER" \
  -v "$TMP_DIR/mock-upstream.mjs:/app/mock-upstream.mjs:ro" \
  node:24.21.0-bookworm-slim node /app/mock-upstream.mjs >/dev/null

MOCK_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$MOCK_CONTAINER")
echo "Mock upstream IP: $MOCK_IP"

# Wait for mock upstream ready
for i in $(seq 1 30); do
  if docker run --rm "$NGINX_IMAGE" wget -q -O- "http://$MOCK_IP:8080/health" 2>/dev/null | grep -q '"status":"ok"'; then
    break
  fi
  sleep 0.1
done

# Create Nginx config pointing to mock upstream
cat << EOF > "$TMP_DIR/mock-nginx.conf"
upstream edgetts_backend {
    server $MOCK_IP:8080;
    keepalive 16;
}

server {
    listen 80;
    server_tokens off;
    client_max_body_size 1m;

    location = /api/speech {
        proxy_pass http://edgetts_backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        proxy_send_timeout 60s;
    }

    location = /v1/audio/speech {
        proxy_pass http://edgetts_backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        proxy_send_timeout 60s;
    }

    location / {
        proxy_pass http://edgetts_backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

docker run -d --name "$MOCK_NGINX_CONTAINER" \
  -p "127.0.0.1:$TEST_PORT:80" \
  -v "$TMP_DIR/mock-nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  "$NGINX_IMAGE" >/dev/null

sleep 1

# Verify /api/speech deterministic streaming:
STREAM1_LOG="$TMP_DIR/stream1.log"
curl -N -s "http://127.0.0.1:$TEST_PORT/api/speech" > "$STREAM1_LOG" &
PID_STREAM1=$!

CHUNK1_OBSERVED=false
for i in $(seq 1 30); do
  if grep -q "CHUNK1_DETERMINISTIC_STREAMING_DATA" "$STREAM1_LOG" 2>/dev/null; then
    CHUNK1_OBSERVED=true
    break
  fi
  sleep 0.1
done

if [ "$CHUNK1_OBSERVED" != "true" ]; then
  echo "FAIL: Chunk 1 was NOT observed before release on /api/speech!"
  kill "$PID_STREAM1" 2>/dev/null || true
  exit 1
fi

if grep -q "CHUNK2_DETERMINISTIC_STREAMING_DATA" "$STREAM1_LOG" 2>/dev/null; then
  echo "FAIL: Chunk 2 arrived prematurely before release on /api/speech!"
  kill "$PID_STREAM1" 2>/dev/null || true
  exit 1
fi
echo "PASS: /api/speech delivered chunk 1 immediately while chunk 2 was withheld."

# Release chunk 2
curl -s -X POST "http://127.0.0.1:$TEST_PORT/release" >/dev/null
wait "$PID_STREAM1"

grep -q "CHUNK2_DETERMINISTIC_STREAMING_DATA" "$STREAM1_LOG" || {
  echo "FAIL: Chunk 2 not present in /api/speech output after release!";
  exit 1;
}
echo "PASS: /api/speech completed stream with chunk 2 after release."

# Verify /v1/audio/speech deterministic streaming:
STREAM2_LOG="$TMP_DIR/stream2.log"
curl -N -s "http://127.0.0.1:$TEST_PORT/v1/audio/speech" > "$STREAM2_LOG" &
PID_STREAM2=$!

CHUNK2_OBSERVED=false
for i in $(seq 1 30); do
  if grep -q "CHUNK1_DETERMINISTIC_STREAMING_DATA" "$STREAM2_LOG" 2>/dev/null; then
    CHUNK2_OBSERVED=true
    break
  fi
  sleep 0.1
done

if [ "$CHUNK2_OBSERVED" != "true" ]; then
  echo "FAIL: Chunk 1 was NOT observed before release on /v1/audio/speech!"
  kill "$PID_STREAM2" 2>/dev/null || true
  exit 1
fi

curl -s -X POST "http://127.0.0.1:$TEST_PORT/release" >/dev/null
wait "$PID_STREAM2"
grep -q "CHUNK2_DETERMINISTIC_STREAMING_DATA" "$STREAM2_LOG" || {
  echo "FAIL: Chunk 2 not present in /v1/audio/speech output after release!";
  exit 1;
}
echo "PASS: /v1/audio/speech confirmed using streaming proxy location (buffering off)."

# Verify status 400 preservation:
RESP_400=$(curl -s -w "\nHTTP_STATUS:%{http_code}\nCONTENT_TYPE:%{content_type}\n" "http://127.0.0.1:$TEST_PORT/mock-400")
echo "$RESP_400" | grep -q "HTTP_STATUS:400" || { echo "FAIL: 400 status not preserved"; exit 1; }
echo "$RESP_400" | grep -qi "CONTENT_TYPE:application/json" || { echo "FAIL: 400 content-type not preserved"; exit 1; }
echo "$RESP_400" | grep -q "INVALID_REQUEST" || { echo "FAIL: 400 error body altered"; exit 1; }
echo "PASS: HTTP 400 status, headers, and JSON body preserved."

# Verify status 503 preservation:
RESP_503=$(curl -s -w "\nHTTP_STATUS:%{http_code}\nCONTENT_TYPE:%{content_type}\n" "http://127.0.0.1:$TEST_PORT/mock-503")
echo "$RESP_503" | grep -q "HTTP_STATUS:503" || { echo "FAIL: 503 status not preserved"; exit 1; }
echo "$RESP_503" | grep -qi "CONTENT_TYPE:application/json" || { echo "FAIL: 503 content-type not preserved"; exit 1; }
echo "$RESP_503" | grep -q "SERVICE_UNAVAILABLE" || { echo "FAIL: 503 error body altered"; exit 1; }
echo "PASS: HTTP 503 status, headers, and JSON body preserved."

# Clean up mock containers
docker rm -f "$MOCK_CONTAINER" "$MOCK_NGINX_CONTAINER" >/dev/null

# ------------------------------------------------------------
# 4. Real EdgeTTS Container Integration
# ------------------------------------------------------------
echo ""
echo "--- [4/5] Real EdgeTTS Container Integration ---"
docker run -d --name "$REAL_BACKEND_CONTAINER" \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --tmpfs /tmp \
  -e "API_KEY=$TEST_API_KEY" \
  "$EDGETTS_IMAGE" >/dev/null

REAL_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$REAL_BACKEND_CONTAINER")
echo "EdgeTTS backend IP: $REAL_IP"

# Wait for EdgeTTS healthy
for i in $(seq 1 40); do
  if docker run --rm "$NGINX_IMAGE" wget -q -O- "http://$REAL_IP:8080/health" 2>/dev/null | grep -q '"status":"ok"'; then
    echo "EdgeTTS backend is healthy."
    break
  fi
  sleep 0.2
done

# Create Nginx config pointing to real backend
cat << EOF > "$TMP_DIR/real-nginx.conf"
upstream edgetts_backend {
    server $REAL_IP:8080;
    keepalive 16;
}

server {
    listen 80;
    server_tokens off;
    client_max_body_size 1m;

    location = /api/speech {
        proxy_pass http://edgetts_backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        proxy_send_timeout 60s;
    }

    location = /v1/audio/speech {
        proxy_pass http://edgetts_backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        proxy_send_timeout 60s;
    }

    location / {
        proxy_pass http://edgetts_backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

docker run -d --name "$REAL_NGINX_CONTAINER" \
  -p "127.0.0.1:$TEST_PORT:80" \
  -v "$TMP_DIR/real-nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  "$NGINX_IMAGE" >/dev/null

sleep 1

# Test GET / -> 200 HTML
HTTP_ROOT_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$TEST_PORT/")
if [ "$HTTP_ROOT_CODE" != "200" ]; then
  echo "FAIL: GET / returned $HTTP_ROOT_CODE (expected 200)"
  exit 1
fi
echo "PASS: GET / returned 200 OK (WebUI SPA served)."

# Test GET /health -> 200
HTTP_HEALTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$TEST_PORT/health")
if [ "$HTTP_HEALTH_CODE" != "200" ]; then
  echo "FAIL: GET /health returned $HTTP_HEALTH_CODE (expected 200)"
  exit 1
fi
echo "PASS: GET /health returned 200 OK."

# Test GET /api/health -> 200
HTTP_API_HEALTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$TEST_PORT/api/health")
if [ "$HTTP_API_HEALTH_CODE" != "200" ]; then
  echo "FAIL: GET /api/health returned $HTTP_API_HEALTH_CODE (expected 200)"
  exit 1
fi
echo "PASS: GET /api/health returned 200 OK."

# Test GET /api/voices (no auth) -> 401
RESP_NOAUTH=$(curl -s -i "http://127.0.0.1:$TEST_PORT/api/voices")
echo "$RESP_NOAUTH" | grep -q "HTTP/1.1 401" || { echo "FAIL: unauthenticated request did not return 401"; exit 1; }
echo "$RESP_NOAUTH" | grep -qi 'www-authenticate: Bearer realm="edgeTTS"' || { echo "FAIL: WWW-Authenticate header missing in 401"; exit 1; }
echo "$RESP_NOAUTH" | grep -qi "content-type: application/json" || { echo "FAIL: Content-Type not application/json in 401"; exit 1; }
echo "$RESP_NOAUTH" | grep -q '"UNAUTHORIZED"' || { echo "FAIL: JSON error code UNAUTHORIZED missing"; exit 1; }
echo "PASS: Unauthenticated /api/voices returned 401 with intact WWW-Authenticate and error body."

# Test GET /api/voices (wrong auth) -> 401
RESP_WRONGAUTH=$(curl -s -i -H "Authorization: Bearer invalid-key-12345678" "http://127.0.0.1:$TEST_PORT/api/voices")
echo "$RESP_WRONGAUTH" | grep -q "HTTP/1.1 401" || { echo "FAIL: invalid key did not return 401"; exit 1; }
echo "PASS: Invalid Bearer key returned 401."

# Test GET /api/voices (correct auth) -> 200
RESP_AUTHOX=$(curl -s -w "\nHTTP_STATUS:%{http_code}\n" -H "Authorization: Bearer $TEST_API_KEY" "http://127.0.0.1:$TEST_PORT/api/voices")
echo "$RESP_AUTHOX" | grep -q "HTTP_STATUS:200" || { echo "FAIL: valid key did not return 200"; exit 1; }
VOICE_COUNT=$(echo "$RESP_AUTHOX" | sed -e '/HTTP_STATUS:/d' | jq -r '.voices | length')
if [ "$VOICE_COUNT" -le 0 ]; then
  echo "FAIL: Voice count is $VOICE_COUNT (expected > 0)"
  exit 1
fi
echo "PASS: Valid Bearer key returned 200 OK with $VOICE_COUNT voices (Authorization header preserved)."

# ------------------------------------------------------------
# 5. One Real Speech Request Through Nginx
# ------------------------------------------------------------
echo ""
echo "--- [5/5] Real Speech Synthesis via Nginx Reverse Proxy ---"
AUDIO_OUTPUT="/tmp/edgetts-nginx-test-audio.mp3"
rm -f "$AUDIO_OUTPUT"

REAL_SPEECH_HEADERS="$TMP_DIR/speech_headers.txt"

curl -s -D "$REAL_SPEECH_HEADERS" \
  -H "Authorization: Bearer $TEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"voice":"zh-CN-XiaoxiaoNeural","quality":"standard","input":"你好，这是 Nginx 反向代理测试。"}' \
  "http://127.0.0.1:$TEST_PORT/api/speech" \
  --output "$AUDIO_OUTPUT"

# Verify HTTP 200
grep -q "HTTP/1.1 200" "$REAL_SPEECH_HEADERS" || {
  echo "FAIL: Real speech synthesis did not return HTTP 200!"
  cat "$REAL_SPEECH_HEADERS"
  exit 1
}

# Verify Content-Type: audio/mpeg
grep -qi "content-type: audio/mpeg" "$REAL_SPEECH_HEADERS" || {
  echo "FAIL: Content-Type is not audio/mpeg!"
  cat "$REAL_SPEECH_HEADERS"
  exit 1
}

# Verify file size > 1000 bytes
AUDIO_BYTES=$(wc -c < "$AUDIO_OUTPUT" | tr -d ' ')
if [ "$AUDIO_BYTES" -le 1000 ]; then
  echo "FAIL: Audio output is only $AUDIO_BYTES bytes (expected > 1000)"
  exit 1
fi
echo "PASS: Real speech synthesis returned HTTP 200, Content-Type: audio/mpeg, $AUDIO_BYTES bytes."

# Verify no artificial buffered Content-Length added by Nginx
# (When streaming chunked with proxy_buffering off, transfer-encoding is chunked)
if grep -qi "transfer-encoding: chunked" "$REAL_SPEECH_HEADERS"; then
  echo "PASS: Transfer-Encoding is chunked (no artificial buffering artifacts)."
fi

# Clean up audio output immediately
rm -f "$AUDIO_OUTPUT"
echo "PASS: Temporary audio file removed immediately."

echo ""
echo "============================================================"
echo "ALL NGINX REVERSE PROXY ACCEPTANCE CRITERIA PASSED!"
echo "============================================================"
