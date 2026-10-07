# syntax=docker/dockerfile:1
# Worker image for apps/worker

FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── deps ──────────────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/worker/package.json             apps/worker/
COPY packages/tsconfig/package.json       packages/tsconfig/
COPY packages/config/package.json         packages/config/
COPY packages/db/package.json             packages/db/
COPY packages/observability/package.json  packages/observability/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY . .

RUN pnpm --filter=@igs/worker run build

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 worker

COPY --from=builder --chown=worker:nodejs /repo/apps/worker/dist ./dist
COPY --from=builder --chown=worker:nodejs /repo/node_modules     ./node_modules

USER worker

CMD ["node", "dist/index.js"]
