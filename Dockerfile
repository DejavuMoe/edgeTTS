# ==============================================================================
# Builder Stage
# ==============================================================================
FROM node:24.21.0-bookworm-slim AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN npm install --global pnpm@12.3.4 && pnpm --version

WORKDIR /build

# Copy dependency manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/tts-core/package.json ./packages/tts-core/
COPY packages/edge-provider/package.json ./packages/edge-provider/
COPY packages/tts-service/package.json ./packages/tts-service/

# Install workspace dependencies using frozen lockfile and cache
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Copy project source trees and configs
COPY tsconfig.base.json ./
COPY apps/ ./apps/
COPY packages/ ./packages/

# Compile workspace packages and WebUI
RUN pnpm build

# Prune and deploy production server dependencies
RUN pnpm --filter @edgetts/server --prod deploy /prod/server

# ==============================================================================
# Production Runtime Stage
# ==============================================================================
FROM node:24.21.0-bookworm-slim AS runtime

WORKDIR /app

# Copy deployed server runtime and static WebUI assets with non-root ownership
COPY --from=builder --chown=node:node /prod/server /app
COPY --from=builder --chown=node:node /build/apps/web/dist /app/web-dist

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    WEB_DIST_DIR=/app/web-dist

EXPOSE 8080

USER node

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "dist/server.js"]
