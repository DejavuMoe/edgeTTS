# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:24.21.0-alpine3.24
ARG BUN_IMAGE=oven/bun:1.4.4-distroless@sha256:153a951ae40106e125898103e6e990ee0f38e6aee7f561029e26cf9fbed23470

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

# Deployed entrypoints are JavaScript; drop TypeScript sources and development metadata.
# License files stay, whatever their extension.
RUN find /prod/server -type f \
      \( -name '*.map' -o -name '*.ts' -o -name '*.mts' -o -name '*.cts' -o -iname '*.md' \) \
      ! -iname 'licen[cs]e*' -delete \
  && find /prod/server/node_modules -type d \
      \( -name test -o -name tests -o -name __tests__ -o -name docs -o -name examples -o -name benchmarks -o -name .github \) \
      -prune -exec rm -rf '{}' + \
  && if find /prod/server -type f \( -name '*.node' -o -name '*.so' \) | grep -q .; then \
       echo 'Native production dependencies require a target-platform deploy stage' >&2; exit 1; \
     fi

RUN mkdir -p /usr/local/share/licenses/bun
# Preserve Bun's license and third-party notices; update the checksum with BUN_IMAGE.
ADD --checksum=sha256:362fe32c954ec829240bd7429c53d705eef08c6bfa45ffc2d02005f857cba4dd --chmod=444 \
  https://raw.githubusercontent.com/oven-sh/bun/bun-v1.4.4/LICENSE.md \
  /usr/local/share/licenses/bun/LICENSE.md

# ==============================================================================
# Production Runtime Stage
# ==============================================================================
# Bun requires glibc and libstdc++; the runtime contains no shell or OS package manager.
FROM ${BUN_IMAGE} AS runtime

COPY --from=builder /etc/passwd /etc/passwd
COPY --from=builder /etc/group /etc/group

COPY --from=builder /usr/local/share/licenses/bun /usr/local/share/licenses/bun

WORKDIR /app

# The service reads its code/assets; it must not be able to overwrite them even when
# an operator omits --read-only. Writable temporary data belongs under /tmp.
COPY --from=builder /prod/server /app
COPY --from=builder /build/apps/web/dist /app/web-dist

ENV NODE_ENV=production \
    BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 \
    HOST=0.0.0.0 \
    PORT=8080 \
    WEB_DIST_DIR=/app/web-dist

EXPOSE 8080

USER node

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || '8080') + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

ENTRYPOINT []
CMD ["bun", "dist/server.js"]
