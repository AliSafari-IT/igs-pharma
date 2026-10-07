# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

IGS-Pharma is a healthcare-grade Belgian online pharmacy platform. Phase 1 is an OTC (non-prescription) webshop. Phase 2 adds prescription reservations. See `docs/` for the complete architecture, compliance requirements, and roadmap.

## Commands

### Daily development

```bash
# Start all apps in parallel (web: 3000, platform: 3001, worker: logs)
pnpm run dev

# Start a single app
pnpm --filter=@igs/web run dev
pnpm --filter=@igs/platform run dev
pnpm --filter=@igs/worker run dev

# Local services (Postgres 5432, Mailpit 8025, MinIO 9001)
docker compose up -d
```

### Type checking & linting

```bash
pnpm run typecheck          # all packages and apps
pnpm run lint               # Biome check + turbo lint
pnpm run format             # Biome auto-format
```

### Testing

```bash
pnpm run test               # Vitest (all packages)
pnpm run test:watch         # watch mode
pnpm --filter=@igs/crypto run test   # single package tests

# E2E (Playwright)
cd e2e && pnpm exec playwright test
pnpm exec playwright test --ui
```

### Database

```bash
pnpm db:generate            # generate Drizzle migration files
pnpm db:migrate             # apply migrations to DATABASE_URL
pnpm db:studio              # open Drizzle Studio
```

### Build

```bash
pnpm run build              # all apps (Next.js standalone + worker dist)
pnpm --filter=@igs/web run build    # single app
```

## Architecture

### Monorepo layout

```
apps/web/        # Storefront (Next.js App Router, port 3000)
apps/platform/   # Back-office (Next.js App Router, port 3001)
apps/worker/     # Background jobs (Node.js, pg-boss)
packages/
  tsconfig/      # Shared TypeScript configs (base/nextjs/node)
  config/        # Typed env vars (Zod) + feature flags
  db/            # Drizzle ORM client, schema, migrations
  auth/          # Better Auth instance + RBAC permissions
  crypto/        # sha256, envelope encryption stubs
  observability/ # Pino logger (PII-aware), OTel stubs
  ui/            # Design tokens (Tailwind v4), shadcn/ui components
  i18n/          # next-intl routing + NL/FR/DE/EN message files
infra/docker/    # Multi-stage Dockerfiles
e2e/             # Playwright tests
```

### Dependency rules

- Apps may import packages; packages may import other packages.
- Packages must NOT import from apps, and no circular deps between packages.
- `eslint-plugin-boundaries` is to enforce this in CI (wired in T-003; not yet active).
- Within a package, only import from the public `index.ts` (or named exports in `package.json#exports`) — never deep-import into another package's `src/`.

### Environment

All env vars are typed and validated at startup via `packages/config/src/env.ts`. Call `getEnv()` instead of `process.env` directly. Required vars: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`. See `.env.example` for the full list.

### Database schema

Schema lives in `packages/db/src/schema/`. The only Phase 0 table is `idempotency_keys` (cross-module deduplication). Domain module schemas (catalog, orders, etc.) are added as separate files in that directory. Run `pnpm db:generate` after every schema change, then `pnpm db:migrate` to apply.

### Auth

`packages/auth/src/index.ts` exports the Better Auth `auth` instance (server-only). `packages/auth/src/client.ts` exports `authClient` for Client Components. The `server-only` package guard prevents the server instance from being bundled into browser code — preserve this.

### i18n

The storefront (`apps/web`) uses `next-intl` with locale-prefixed URLs (`/nl/`, `/fr/`, `/de/`, `/en/`). Default locale is `nl`. The middleware in `apps/web/src/middleware.ts` handles locale detection. Message files are in `packages/i18n/messages/*.json`. The back-office (`apps/platform`) is staff-only and uses English without URL prefixes.

### Styling

Tailwind CSS v4 with CSS-native `@theme {}` design tokens defined in `packages/ui/src/styles/tokens.css`. All color/spacing/font tokens live there — do not add raw hex values in component code, use `var(--color-primary)` etc. Import order in layouts: `tokens.css` then `global.css`.

### TypeScript

- All packages extend `@igs/tsconfig/base.json` (or `nextjs.json` for React code, `node.json` for the worker).
- `"moduleResolution": "Bundler"` everywhere (apps, packages, worker) — internal packages export TS source and use extensionless relative imports. The worker runs via `tsx`; `tsc` there only typechecks.
- `verbatimModuleSyntax` is on — use `import type` for type-only imports.
- `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are enabled — array access returns `T | undefined`.

### CI pipeline

`.github/workflows/ci.yml` runs: lint → typecheck → test (parallel), then build (after all pass), plus Gitleaks secret scanning on every push. Turbo remote cache is enabled via `TURBO_TOKEN`/`TURBO_TEAM` secrets.
