# Nginx deployment

Use the [reverse-proxy guide](../../docs/en/reverse-proxy.md) for installation, certificates and streaming configuration.

- [`edgetts.conf.example`](edgetts.conf.example) is the canonical Nginx template.
- [`test-proxy.sh`](test-proxy.sh) derives its checks from that template. It requires Docker, curl, openssl, jq, awk and sed.
- Run `EDGETTS_NGINX_SKIP_LIVE=1 ./deploy/nginx/test-proxy.sh` from the repository root for deterministic proxy checks without Microsoft calls. Docker may still need to download images.
- Omit `EDGETTS_NGINX_SKIP_LIVE` for live verification using `EDGETTS_TEST_IMAGE=edgetts:local`. Set `EDGETTS_NGINX_TEST_PORT` to change the default test port, `18082`.
