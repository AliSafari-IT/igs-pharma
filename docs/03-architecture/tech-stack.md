# Tech Stack (as of 7 October 2026)

Pin exact versions in `package.json` / `.tool-versions` at kickoff and let **Renovate** keep
them current. "Latest stable" below means: the latest stable release line at kickoff.

## Core

| Layer | Choice | Why | Alternatives considered |
|---|---|---|---|
| Language | **TypeScript** (strict) | One language front to back; shared types/schemas | — |
| Runtime | **Node.js 24 LTS** | Active LTS, stable for Next.js and workers | Bun (fast, but less proven for this risk profile) |
| Package manager / monorepo | **pnpm 10 + Turborepo** | Fast, strict deps, remote cache, simple | Nx (heavier) |
| Web framework | **Next.js 16.x** (App Router, React 19.2, Turbopack, Cache Components, `proxy.ts`) | Best-in-class SSR/RSC for SEO-heavy commerce; Server Actions for forms; one framework for both apps | Remix/React Router 7, Astro (great for content, weaker for app-like back-office), Nuxt |
| UI | **Tailwind CSS v4** + **shadcn/ui** (Radix primitives) + design tokens | Own the components; accessible primitives; tokens map 1:1 to brand | MUI/Chakra (harder to brand premium) |
| Forms & validation | **Zod 4** + React Hook Form (client) / `useActionState` (Server Actions) | Single schema for client, server, DB inputs, OpenAPI | Valibot |
| i18n | **next-intl** | App Router native, ICU messages, typed keys | Lingui |
| Database | **PostgreSQL 17/18** (managed, HA, PITR) | Reliability, JSONB, FTS, RLS, partitioning; managed EU options | MySQL, MongoDB (not suited to transactional health data) |
| ORM / SQL | **Drizzle ORM + drizzle-kit** | SQL-first, typed, lightweight, great migrations; raw SQL when needed | Prisma 7 (good; heavier abstraction), Kysely (query builder only) |
| Auth | **Better Auth** | Self-hosted, data in our Postgres, passkeys, 2FA, org/roles plugins, OIDC client for itsme® | Keycloak/Zitadel (separate service to run), Clerk/Auth0 (US SaaS → data residency concerns) |
| Authorization | Own **RBAC + ABAC** layer (`packages/auth/permissions`) + **Postgres RLS** on sensitive schemas | Explicit, testable, defense in depth | Cerbos / OpenFGA (later, if rules explode) |
| Jobs & scheduling | **pg-boss** (or Graphile Worker) | Jobs in Postgres → transactional with business data, no Redis | BullMQ + Redis, Temporal (overkill now) |
| Events | **Transactional outbox** table + relay in worker | Reliable side-effects without a broker | Kafka/NATS (not needed at this scale) |
| Search | **Postgres FTS + `pg_trgm` + `unaccent`** (NL/FR/DE configs) → **Meilisearch** in Phase 1.5 | Start simple; Meilisearch for typo-tolerance, synonyms, facets at scale | Typesense, Elasticsearch/OpenSearch (heavy) |
| CMS | **Payload CMS 3** embedded in `apps/platform` (Postgres adapter) | Next.js-native, TS config, versioning & approval workflows, own DB | Strapi, Sanity/Contentful (SaaS, non-EU data) |
| File storage | **S3-compatible EU object storage** | Images, leaflets, invoices; encrypted buckets for sensitive docs | — |
| Images | `next/image` + provider image CDN / imgproxy | Responsive, AVIF/WebP | — |
| PDF (invoices, labels) | `@react-pdf/renderer` or Typst/Gotenberg service | Deterministic invoice PDFs | — |
| E-mail | **React Email** templates + EU provider (Brevo, Scaleway TEM, Mailjet) | Typed templates, 4 languages | Postmark/SendGrid (US) |
| SMS | EU provider (e.g. Brevo, MessageBird/Bird, Vonage EU) | Pickup notifications, OTP fallback | — |
| Payments | **Mollie** (recommended for BE/NL SMB), or Adyen / Stripe | Bancontact, cards, Apple/Google Pay, Wero/Payconiq, SEPA; EU entity | See [integrations](integrations.md) |
| Shipping | **Sendcloud** (multi-carrier) or direct bpost/PostNL APIs | Labels, tracking, returns portal | — |
| Product data | **Medipim** API + **SAM** (FAMHP) exports | Belgian pharmacy product content & authentic medicine data | Manual entry |
| Bot protection | **Friendly Captcha** (EU) or Cloudflare Turnstile | Privacy-friendly | reCAPTCHA (GDPR issues) |
| Analytics | **Self-hosted Umami / Plausible / Matomo** (EU) | First-party, cookieless option, no health data leakage | GA4 (avoid) |

## Quality & tooling

| Purpose | Tool |
|---|---|
| Lint / format | **Biome** (or ESLint 9 flat + Prettier) + `eslint-plugin-boundaries` / dependency-cruiser for module boundaries |
| Unit / integration tests | **Vitest** + **Testcontainers** (real Postgres) |
| E2E | **Playwright** (+ `@axe-core/playwright` for accessibility) |
| Component dev | **Storybook 9** with a11y addon, visual regression (Chromatic or Playwright snapshots) |
| API docs | OpenAPI generated from Zod (`zod-openapi`), Scalar UI |
| Load tests | **k6** |
| Security scanning | GitHub CodeQL / Semgrep, `pnpm audit`, **Renovate**, Trivy (images), Gitleaks (secrets), OWASP ZAP baseline in CI |
| SBOM | CycloneDX generated per build |
| Observability | **OpenTelemetry** SDK → Grafana (Loki, Tempo, Mimir/Prometheus) — e.g. Scaleway Cockpit or Grafana Cloud EU; **Sentry** EU region or self-hosted GlitchTip |
| Uptime / synthetic | Checkly / Grafana synthetic monitoring / Better Stack (EU) |
| Feature flags | DB-backed flags via OpenFeature provider (or Unleash self-hosted) |
| Infra as code | **OpenTofu / Terraform** (provider for Scaleway/OVH) |
| Containers | Docker (multi-stage, distroless/`node:24-alpine`), Next.js `output: "standalone"` |
| CI/CD | **GitHub Actions** → container registry (EU) → deploy |

## AI (optional, guard-railed)

- **Semantic product search & synonyms** (e.g. embeddings in `pgvector`) — Phase 1.5.
- **Staff assistants** (summarise customer questions, draft replies, translate content for
  pharmacist approval) — never auto-send medical advice; EU-hosted or EU-data-residency model
  endpoints with no-training / zero-retention terms; AI Act transparency.

## What we deliberately do NOT use (now)

- Microservices, Kubernetes, Kafka, Redis, GraphQL federation — operational cost without a
  current need. Revisit with data.
- Headless SaaS commerce (Shopify, commercetools) — pharmacy-specific workflows, health data
  residency and LGO coupling fight against them. See [ADR-0007](adr/0007-own-commerce-core.md).
