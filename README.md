# EdgeTTS

Self-hosted Edge TTS Web application and API skeleton.

> **Note:** The Edge provider is implemented internally, but no public speech HTTP endpoint exists yet.

## Architecture

- `apps/server`: Fastify HTTP API service (`@edgetts/server`).
- `apps/web`: React + Vite frontend application (`@edgetts/web`).
- `packages/shared`: Shared TypeScript types and Zod schemas (`@edgetts/shared`).
- `packages/tts-core`: Provider-neutral TTS domain contracts (`@edgetts/tts-core`), defining synthesis controls: `speed` (0.5–2.0), `pitchSemitones` (-12–12), and `volume` (0–1).
- `packages/edge-provider`: Microsoft Edge Read Aloud adapter (`@edgetts/edge-provider`), mapping domain prosody controls to `msedge-tts`.

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

To run the live Edge TTS provider smoke test against the Microsoft endpoint:

```bash
pnpm --filter @edgetts/edge-provider smoke
```
