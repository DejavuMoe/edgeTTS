# Deployment templates

| Path                                               | Purpose                                                        |
| :------------------------------------------------- | :------------------------------------------------------------- |
| [compose/compose.yaml](compose/compose.yaml)       | Production Docker Compose file for the published image         |
| [systemd/edgetts.service](systemd/edgetts.service) | Service unit for a bare-metal Node.js installation             |
| [nginx/](nginx/README.md)                          | Nginx reverse-proxy template and its deterministic test script |

The deployment guides embed these files; `pnpm test` fails if a guide drifts from them. The
`compose.yaml` at the repository root is different: it builds `edgetts:local` from the working
tree for development. See the [deployment guide](../docs/en/deployment.md) for each method.
