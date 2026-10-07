# Repository Structure

Monorepo: **pnpm workspaces + Turborepo**. Target layout:

```
igs-pharma/
├── apps/
│   ├── web/                    # Storefront (Next.js)
│   │   ├── src/app/[locale]/   # Routes: (shop), (account), checkout, legal…
│   │   ├── src/components/     # App-specific composites (use packages/ui primitives)
│   │   ├── src/i18n/           # next-intl config, routing
│   │   ├── proxy.ts            # Locale detection, security headers (no authz here)
│   │   └── next.config.ts
│   ├── platform/               # Back-office + Payload CMS (Next.js)
│   │   ├── src/app/(platform)/ # Dashboard, review, orders, fulfilment, catalogue…
│   │   ├── src/app/(payload)/  # Payload admin & API routes
│   │   ├── src/app/api/        # Webhooks (PSP, carrier), integration API (OpenAPI)
│   │   └── payload.config.ts
│   └── worker/                 # Jobs, outbox relay, schedules, imports (Node)
│       └── src/{jobs,schedules,subscribers}/
├── packages/
│   ├── modules/                # Domain modules — the heart of the system
│   │   ├── catalog/
│   │   │   ├── src/index.ts    # PUBLIC API: commands, queries, events, types
│   │   │   ├── src/commands/   # e.g. publishProduct.ts
│   │   │   ├── src/queries/    # e.g. getProductBySlug.ts
│   │   │   ├── src/events.ts
│   │   │   ├── src/schema.ts   # Drizzle tables (schema "catalog")
│   │   │   ├── src/adapters/   # medipim/, sam/
│   │   │   └── test/
│   │   ├── pricing/  inventory/  cart/  orders/  payments/  fulfilment/
│   │   ├── customers/  pharmacy/ (rules, questionnaires, review)  content/
│   │   ├── identity/  audit/  privacy/  notify/  files/
│   │   └── rx/  care/  patients/          # Phase 2
│   ├── db/                     # Drizzle client, migrations, RLS policies, seeds, test utils
│   ├── auth/                   # Better Auth config, permissions (RBAC/ABAC), authorize()
│   ├── ui/                     # Design tokens, shadcn/ui components, Storybook
│   ├── i18n/                   # Messages nl/fr/de/en, formatters, locale utils
│   ├── emails/                 # React Email templates
│   ├── observability/          # OTel setup, logger (PII-scrubbing), error reporting
│   ├── config/                 # Typed env (Zod), feature flags
│   ├── crypto/                 # Envelope encryption helpers (KMS), hashing
│   └── tsconfig/ eslint-config/ # Shared tooling config
├── infra/
│   ├── tofu/                   # OpenTofu/Terraform: network, DB, buckets, containers, DNS
│   └── docker/                 # Dockerfiles (web, platform, worker)
├── e2e/                        # Playwright tests (cross-app), axe checks
├── load/                       # k6 scripts
├── docs/                       # ← this documentation
├── .github/workflows/          # CI/CD
├── turbo.json  pnpm-workspace.yaml  package.json  biome.json  renovate.json
└── README.md
```

## Dependency rules (enforced in CI)

```mermaid
flowchart TB
    apps[apps/*] --> modules[packages/modules/*]
    apps --> ui[packages/ui]
    apps --> i18n[packages/i18n]
    modules --> db[packages/db]
    modules --> auth[packages/auth]
    modules --> crypto[packages/crypto]
    modules --> obs[packages/observability]
    modules --> config[packages/config]
    ui -.x.-> modules
    db -.x.-> modules
```

- `apps/*` → may import `packages/*`. Apps never import each other.
- A module imports **only the public `index.ts`** of another module (no deep imports, no foreign tables).
- `packages/ui` is pure presentation (no data access).
- Server-only code marked with `import "server-only"`.
- Circular dependencies fail the build (dependency-cruiser / `eslint-plugin-boundaries`).

## Module anatomy (example)

```ts
// packages/modules/orders/src/commands/approveReview.ts
export const approveReview = command({
  name: "orders.review.approve",
  input: z.object({ orderId: zUuid, notes: z.string().max(2000).optional() }),
  permission: "orders.review.decide",
  async handler({ input, actor, tx }) {
    const order = await orders.lockById(tx, input.orderId);
    assertTransition(order.status, "ready_for_fulfilment");
    await orders.transition(tx, order, "ready_for_fulfilment", { actor, reason: "pharmacist_approved" });
    await audit.record(tx, { actor, action: "pharmacy.review.decided", entity: order, data: { decision: "approved" } });
    await outbox.publish(tx, "order.review_approved", { orderId: order.id });
  },
});
```

A `command()` helper wraps: Zod validation → authorization → DB transaction → audit → outbox →
OpenTelemetry span. Server Actions, route handlers and jobs all call commands — never tables.
