# EdgeTTS

Self-hosted Edge TTS Web application and API skeleton.

> **Note:** The Edge TTS provider is not implemented yet. Phase 0 establishes the engineering baseline and monorepo architecture skeleton.

## Architecture

- `apps/server`: Fastify HTTP API service (`@edgetts/server`).
- `apps/web`: React + Vite frontend application (`@edgetts/web`).
- `packages/shared`: Shared TypeScript types and Zod schemas (`@edgetts/shared`).
- `packages/tts-core`: Domain boundaries and provider interface definitions (`@edgetts/tts-core`).

## Requirements

- Node.js (v24 LTS recommended)
- pnpm (v10+ or v12+)

## Install

```bash
pnpm install
```

## Development

Start both the Fastify server and Vite dev server concurrently:

```bash
pnpm dev
```

- Server: `http://127.0.0.1:8080`
- Web UI: Vite local dev server (proxies `/api` to `http://127.0.0.1:8080`)

## Validation

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```
