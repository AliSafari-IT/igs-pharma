# 0002 — Next.js monorepo with two apps + worker

- Status: Proposed
- Date: 2026-10-07

## Context
Customers and staff have very different needs: SEO, caching and performance for the shop;
security, density and productivity for the back-office. Both share the domain.

## Decision
- **pnpm + Turborepo monorepo**.
- `apps/web` — storefront (Next.js, public, cached).
- `apps/platform` — back-office + Payload CMS (Next.js, authenticated, separate sub-domain).
- `apps/worker` — Node process for jobs/outbox/imports.
- Shared `packages/*` for modules, db, auth, ui, i18n, config.
- Next.js latest stable (16.x at time of writing): App Router, React Server Components,
  Server Actions, Cache Components (`use cache`, `cacheTag`), Turbopack, `output: "standalone"`.

## Consequences
- ✅ Separate security perimeters (cookies, CSP, WAF rules, IP allow-list for `platform`).
- ✅ Independent deploys and scaling; shared types and UI.
- ⚠️ Two apps to keep on the same Next.js version — Renovate groups them.

## Alternatives considered
- One Next.js app with `/admin` — larger attack surface on the public origin, mixed caching rules.
- Separate SPA back-office (Vite/React) — fine technically, but loses shared RSC patterns and Payload.
