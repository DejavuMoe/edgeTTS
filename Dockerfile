# syntax=docker/dockerfile:1

# Both stages share one Alpine release so the musl-linked Node binary copied into the runtime
# matches the C library it was built against.
ARG NODE_IMAGE=node:24.21.0-alpine3.24
ARG ALPINE_IMAGE=alpine:3.24

FROM ${NODE_IMAGE} AS node

# Keep executable code, ICU, TLS and dynamic symbols; only discard debug/linker metadata.
# Use the target architecture's strip, and leave binutils in this disposable stage.
RUN apk add --no-cache binutils \
  && strip --strip-unneeded /usr/local/bin/node

# ==============================================================================
# Builder Stage
# ==============================================================================
# TypeScript, Vite and the deployed production dependencies are platform-independent JS.
# Build once on the builder's native CPU instead of compiling again under ARM emulation.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN npm install --global pnpm@12.3.4 && pnpm --version

WORKDIR /build

# Copy dependency manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches/ ./patches/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/tts-core/package.json ./packages/tts-core/
COPY packages/edge-provider/package.json ./packages/edge-provider/
COPY packages/tts-service/package.json ./packages/tts-service/

# Install workspace dependencies using frozen lockfile and cache
RUN --mount=type=cache,id=pnpm,target=/pnpm/store,sharing=locked pnpm install --frozen-lockfile

# Copy project source trees and configs
COPY tsconfig.base.json ./
COPY apps/ ./apps/
COPY packages/ ./packages/

# Compile workspace packages and WebUI
RUN pnpm build

# Prune and deploy production server dependencies
RUN pnpm --filter @edgetts/server --prod deploy /prod/server

# Drop what Node never loads at runtime: source maps, type declarations and Markdown docs.
# License files stay, whatever their extension.
RUN find /prod/server -type f \
      \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -iname '*.md' \) \
      ! -iname 'licen[cs]e*' -delete \
  && find /prod/server/node_modules -type d \
      \( -name test -o -name tests -o -name __tests__ -o -name docs -o -name examples -o -name benchmarks \) \
      -prune -exec rm -rf '{}' + \
  && if find /prod/server -type f \( -name '*.node' -o -name '*.so' \) | grep -q .; then \
       echo 'Native production dependencies require a target-platform deploy stage' >&2; exit 1; \
     fi

# ==============================================================================
# Production Runtime Stage
# ==============================================================================
# Plain Alpine plus the Node binary: no npm, npx, Yarn or Corepack in the shipped image.
FROM ${ALPINE_IMAGE} AS runtime

# The same runtime library and UID/GID 1000 "node" account the official Node image provides.
RUN apk add --no-cache libstdc++ \
  && addgroup -g 1000 node \
  && adduser -u 1000 -G node -s /bin/sh -D node

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/LICENSE /usr/local/share/licenses/node/LICENSE

WORKDIR /app

# The service reads its code/assets; it must not be able to overwrite them even when
# an operator omits --read-only. Writable temporary data belongs under /tmp.
COPY --from=builder /prod/server /app
COPY --from=builder /build/apps/web/dist /app/web-dist

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
