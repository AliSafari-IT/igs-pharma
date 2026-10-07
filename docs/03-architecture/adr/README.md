# Architecture Decision Records

Format: lightweight [MADR](https://adr.github.io/madr/). One decision per file, numbered,
never deleted — superseded ADRs link to their replacement.

| # | Decision | Status |
|---|---|---|
| [0001](0001-modular-monolith.md) | Modular monolith over microservices | Proposed |
| [0002](0002-nextjs-monorepo-two-apps.md) | Next.js monorepo with two apps (`web`, `platform`) + worker | Proposed |
| [0003](0003-postgresql-drizzle.md) | PostgreSQL with schema-per-module, Drizzle ORM | Proposed |
| [0004](0004-better-auth.md) | Better Auth for authentication; itsme® for Phase 2 identity | Proposed |
| [0005](0005-eu-sovereign-hosting.md) | EU-sovereign hosting for all personal/health data | Proposed |
| [0006](0006-postgres-jobs-and-outbox.md) | Postgres-backed jobs and transactional outbox | Proposed |
| [0007](0007-own-commerce-core.md) | Own commerce core instead of a commerce platform | Proposed |
| [0008](0008-integrate-certified-lgo-for-dispensing.md) | Integrate certified LGO for dispensing; don't rebuild | Proposed |
| [0009](0009-cnk-product-identity-and-catalogue-sources.md) | CNK as product identity; Medipim + SAM as sources | Proposed |
| [0010](0010-multilingual-from-day-one.md) | NL/FR/DE/EN from day one | Proposed |

## Template

```md
# NNNN — Title
- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD
- Deciders: …

## Context
## Decision
## Consequences
## Alternatives considered
```
