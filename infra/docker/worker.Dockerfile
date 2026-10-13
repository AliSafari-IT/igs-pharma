# syntax=docker/dockerfile:1
# Worker image for apps/worker.
# The worker is bundled with tsup (workspace packages inlined, D-007); the runner stage only
# needs the bundle plus the worker's *production* dependencies.

# Base image pinned by digest (node:24-alpine); Renovate bumps it.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base
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
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 --ingroup nodejs worker

# package.json carries "type": "module" (the bundle is ESM)
COPY --from=builder --chown=worker:nodejs /out/package.json ./package.json
COPY --from=builder --chown=worker:nodejs /out/dist         ./dist
COPY --from=builder --chown=worker:nodejs /out/node_modules ./node_modules
# the committed migrations, for the one-shot `node dist/migrate.js` entry (igs-pharma#46)
COPY --from=builder --chown=worker:nodejs /repo/packages/db/drizzle ./drizzle

USER worker

# default: the worker. One-shot entries in the same image (override the command):
#   node dist/migrate.js          migrations + pg-boss schema, before the apps start
#   node dist/bootstrap-owner.js  the first owner's enrolment link (36b)
#   node dist/seed-catalog.js     fake catalogue for staging (needs IGS_ALLOW_SYNTHETIC_SEED=1, igs-pharma#50)
CMD ["node", "dist/index.js"]
