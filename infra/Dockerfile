# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────────────────
# CropCard production image.
#
# Stages:
#   base     — node:22-alpine + pnpm via corepack + litestream binary
#   deps     — pnpm install (cached layer)
#   build    — svelte-kit build → build/
#   dev      — local dev server target (used by docker-compose)
#   runtime  — slim final image with built app + litestream + entrypoint
# ─────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=22-alpine
ARG LITESTREAM_VERSION=0.3.13

# ─── base ───────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
RUN apk add --no-cache python3 make g++ sqlite curl ca-certificates bash
WORKDIR /app

# Pull litestream once and keep it in a known location
ARG LITESTREAM_VERSION
ARG TARGETARCH
RUN case "${TARGETARCH}" in \
      amd64) LS_ARCH=amd64 ;; \
      arm64) LS_ARCH=arm64 ;; \
      *)     LS_ARCH=amd64 ;; \
    esac && \
    curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-${LS_ARCH}.tar.gz" \
      | tar -xz -C /usr/local/bin litestream && \
    chmod +x /usr/local/bin/litestream

# ─── deps ───────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile=false

# ─── build ──────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN pnpm --filter @cropcard/web build

# ─── dev (used by docker-compose for HMR) ───────────────────────────────
FROM deps AS dev
COPY . .
ENV NODE_ENV=development
EXPOSE 5173
CMD ["pnpm", "--filter", "@cropcard/web", "dev"]

# ─── runtime ────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
RUN apk add --no-cache sqlite ca-certificates tini
WORKDIR /app

# Litestream binary
COPY --from=base /usr/local/bin/litestream /usr/local/bin/litestream

# Built SvelteKit (Node adapter)
COPY --from=build /app/apps/web/build ./build
COPY --from=build /app/apps/web/package.json ./package.json
COPY --from=build /app/apps/web/drizzle ./drizzle

# Production-only deps
COPY --from=build /app/node_modules ./node_modules

# Entrypoint + Litestream config
COPY infra/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY infra/litestream.yml /etc/litestream.yml
RUN chmod +x /usr/local/bin/entrypoint.sh

# Non-root execution
RUN addgroup -S app && adduser -S app -G app && \
    mkdir -p /data && chown -R app:app /data /app
USER app

ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/cropcard.db
ENV HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
