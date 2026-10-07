# syntax=docker/dockerfile:1
# Multi-stage Next.js standalone build for apps/platform

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

ARG DATABASE_URL
ARG AUTH_SECRET
ARG AUTH_URL

ENV DATABASE_URL=$DATABASE_URL
ENV AUTH_SECRET=$AUTH_SECRET
ENV AUTH_URL=$AUTH_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter=@igs/platform run build

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /repo/apps/platform/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/platform/.next/static      ./apps/platform/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/platform/public            ./apps/platform/public

USER nextjs
EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/platform/server.js"]
