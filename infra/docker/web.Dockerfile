# syntax=docker/dockerfile:1
# Multi-stage Next.js standalone build for apps/web

FROM node:24-alpine AS base
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

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
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

CMD ["node", "apps/web/server.js"]
