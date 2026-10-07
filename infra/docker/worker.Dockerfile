# syntax=docker/dockerfile:1
# Worker image for apps/worker.
# The worker is bundled with tsup (workspace packages inlined, D-007); the runner stage only
# needs the bundle plus the worker's *production* dependencies.

FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /repo
# Whole workspace: pnpm's frozen-lockfile check needs every workspace project's manifest, and
# keeping the list of COPY lines in sync by hand breaks whenever a package is added.
COPY . .

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Bundle, then extract a self-contained production tree. `pnpm deploy` copies the worker and
# installs only its production dependencies (no devDependencies, no other apps) into /out; it is
# preferred over copying the whole node_modules because that would ship every workspace's
# dev tooling (typescript, vitest, tsup, next…). `--legacy` is needed because we do not enable
# pnpm's `inject-workspace-packages`.
RUN pnpm --filter=@igs/worker run build && \
    pnpm --filter=@igs/worker --prod deploy --legacy /out

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 --ingroup nodejs worker

# package.json carries "type": "module" (the bundle is ESM)
COPY --from=builder --chown=worker:nodejs /out/package.json ./package.json
COPY --from=builder --chown=worker:nodejs /out/dist         ./dist
COPY --from=builder --chown=worker:nodejs /out/node_modules ./node_modules

USER worker

CMD ["node", "dist/index.js"]
