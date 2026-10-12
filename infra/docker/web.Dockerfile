# syntax=docker/dockerfile:1
# Multi-stage Next.js standalone build for apps/web

# Base image pinned by digest (node:24-alpine); Renovate bumps it.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /repo
# Whole workspace: pnpm's frozen-lockfile check needs every workspace project's manifest, and
# keeping a hand-maintained COPY list in sync breaks whenever a package is added.
COPY . .

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

ENV NEXT_TELEMETRY_DISABLED=1

# D-023: image builds never receive real secrets (no ARG/ENV: build args and builder layers end up
# in the build cache). The env schema only needs *valid-looking* values to build; these obviously
# fake placeholders live on this RUN line alone, so they are not persisted as image ENV. Real
# values are injected at runtime only (getEnv() is lazy).
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    AUTH_SECRET=build-only-placeholder-not-a-secret-000000 \
    AUTH_URL=http://localhost \
    pnpm --filter=@igs/web run build

# ASafariM OS manifest (OS ADR 0001 §0): the image carries apps/web/platform.app.json as the
# `org.asafarim.app.manifest` label. A Dockerfile can't read a file into a LABEL, so the build gets
# it as APP_MANIFEST (CI: `jq -c . apps/web/platform.app.json`) and fails if it is missing or differs.
ARG APP_MANIFEST
RUN node -e ' \
      const want = require("./apps/web/platform.app.json"); \
      if (!process.env.APP_MANIFEST) throw new Error("pass --build-arg APP_MANIFEST=\"$(jq -c . apps/web/platform.app.json)\""); \
      require("node:assert").deepStrictEqual(JSON.parse(process.env.APP_MANIFEST), want, "APP_MANIFEST differs from apps/web/platform.app.json");'

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static      ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public            ./apps/web/public

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ARG APP_MANIFEST
LABEL org.asafarim.app.manifest="${APP_MANIFEST}"

CMD ["node", "apps/web/server.js"]
