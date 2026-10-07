# 0003 — PostgreSQL with schema-per-module, Drizzle ORM

- Status: Proposed
- Date: 2026-10-07

## Context
Transactional integrity across orders, stock, payments and audit; JSONB for translated content;
full-text search; row-level security; mature EU managed offerings.

## Decision
- **PostgreSQL 17/18** (latest version supported by the chosen managed service), HA with
  synchronous standby, PITR, encrypted.
- **Schema per module** (`catalog`, `orders`, `inventory`, `pharmacy`, `audit`, …).
- **Drizzle ORM** for typed queries and **drizzle-kit** for SQL migrations (reviewed SQL in PRs).
- Extensions: `pgcrypto`, `citext`, `pg_trgm`, `unaccent`, `pg_stat_statements`, later `pgvector`.

## Consequences
- ✅ SQL-first, transparent queries; easy to use raw SQL for reports and RLS policies.
- ⚠️ Migrations must be backward compatible (expand → migrate → contract) for zero-downtime deploys.

## Alternatives considered
- **Prisma 7** — strong DX; heavier abstraction, less natural for RLS/session variables.
- **Kysely** — great builder; Drizzle adds schema + migrations in one tool.
