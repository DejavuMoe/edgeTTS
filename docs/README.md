# Documentation

User guides exist in three languages with the same structure. `pnpm test` checks that the
translations reference the same variables, error codes and routes, and that every link resolves.

| Guide                                    | English                              | 简体中文                           | 日本語                                  |
| :--------------------------------------- | :----------------------------------- | :--------------------------------- | :-------------------------------------- |
| Deployment (Compose, container, systemd) | [deployment](en/deployment.md)       | [部署指南](zh-CN/deployment.md)    | [デプロイ](ja/deployment.md)            |
| Reverse proxy and TLS                    | [reverse-proxy](en/reverse-proxy.md) | [反向代理](zh-CN/reverse-proxy.md) | [リバースプロキシ](ja/reverse-proxy.md) |
| Configuration (environment variables)    | [configuration](en/configuration.md) | [配置参考](zh-CN/configuration.md) | [設定](ja/configuration.md)             |
| HTTP API                                 | [api](en/api.md)                     | [API 参考](zh-CN/api.md)           | [API](ja/api.md)                        |

[openapi.json](openapi.json) is the machine-readable API description. It is generated from the
validation schemas with `pnpm --filter @edgetts/server openapi`; `pnpm test` fails when it is stale.

## Development

- [Architecture and design decisions](development/architecture.md)
- [Releases, rollback and dependency maintenance](development/releasing.md)
- Research records (Chinese): [ablation experiments](development/research/ablation.zh-CN.md) and
  [long-text performance](development/research/performance.zh-CN.md)

Deployment templates live in [deploy/](../deploy/README.md), and the changes of each release in
the [changelog](../CHANGELOG.md).
