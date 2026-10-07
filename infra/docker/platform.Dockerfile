# syntax=docker/dockerfile:1
# Multi-stage Next.js standalone build for apps/platform

FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── deps ──────────────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/platform/package.json           apps/platform/
COPY packages/tsconfig/package.json       packages/tsconfig/
COPY packages/config/package.json         packages/config/
COPY packages/db/package.json             packages/db/
COPY packages/auth/package.json           packages/auth/
COPY packages/crypto/package.json         packages/crypto/
COPY packages/observability/package.json  packages/observability/
COPY packages/ui/package.json             packages/ui/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY . .

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
