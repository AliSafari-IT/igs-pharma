# Database Migrations

Drizzle generates plain SQL files in `packages/db/drizzle/`. Table definitions live in the owning
module (D-001); `packages/db` aggregates them by path glob (see `packages/db/README.md`).

## Policy

1. **Forward-only in production.** No down-migrations. A mistake is fixed by a new migration.
2. **Never edit an applied migration** (anything merged to `main`). Add a new one. CI re-applies the whole chain from empty on every run, so an edited file would diverge from every database that already ran it.
3. **Expand / contract.** Schema changes that old code cannot tolerate are done in two releases:
   - *expand*: add the new column/table/index as nullable or with a default; deploy code that writes both and reads the new one;
   - *contract* (a later release, after all code stopped using the old shape): drop the old column/table.
4. **No destructive change in a single release.** `DROP COLUMN/TABLE`, type narrowing, `SET NOT NULL` on populated data, renames: all need the two-step path above (a rename = add new + backfill + switch + drop old).
5. **One concern per migration PR.** Keep schema changes separate from feature code where practical, so the SQL can be reviewed on its own.
6. **Review the generated SQL.** `drizzle-kit generate` output is a draft: read it for locks (index creation on big tables → `CONCURRENTLY` in a hand-edited migration), data loss, and defaults. Migrations need **2 approvals** (development-workflow.md).
7. **Extensions and privileged statements** (`CREATE EXTENSION`, roles, grants) go in hand-written custom migrations (`drizzle-kit generate --custom --name=<what>`), kept idempotent (`IF NOT EXISTS`) and ordered before the tables that need them (e.g. `0000_extensions.sql` for `citext`).
8. Primary keys are UUIDv7 generated in the app (`newId()`), timestamps are `timestamptz` (D-003).

## Workflow

```bash
# 1. edit packages/modules/<m>/src/schema.ts (or packages/db/src/schema/shared.ts)
pnpm db:generate     # 2. creates packages/db/drizzle/NNNN_*.sql + meta/ snapshot — commit both
pnpm db:migrate      # 3. apply to DATABASE_URL (local docker compose Postgres)
pnpm db:check        # 4. drift check: fails if the schema differs from the committed migrations
pnpm --filter=@igs/db test   # 5. migrations + harness tests on real Postgres
```

## CI guards

| Guard | What it catches |
|---|---|
| `pnpm db:check` (lint job) | Schema changed but no migration committed. Runs `drizzle-kit generate` into a scratch copy and fails if it would emit a new file; prints the SQL it would generate. |
| `pnpm --filter=@igs/db test` (test job) | Migrations fail on an empty `postgres:17-alpine`, re-applying is not a no-op, or a constraint (e.g. citext email) misbehaves. |

## Integration-test harness (`@igs/db/testing`)

Test-only (never import it from app or module runtime code). One Postgres per test run
(Testcontainers, `postgres:17-alpine` — same major as `docker-compose.yml`), migrated once into a
template database and shared across files through Vitest `globalSetup`:

- `withTestTx(async (tx) => …)` — runs on the shared migrated database inside a transaction that is **always rolled back**.
- `createIsolatedDatabase()` — a fresh migrated database cloned from the template (cheap), for tests that need DDL or grants; `createIsolatedDatabase({ migrated: false })` gives an empty one. Call `drop()` when done.

Use it from a package's `vitest.config.ts`: `test.globalSetup: ["@igs/db/testing/global-setup"]`.

**Without Docker:** set `TEST_DATABASE_URL` to a superuser connection of a local Postgres (e.g. `postgresql://igs:igs@localhost:5432/postgres`). The harness then only creates and drops databases prefixed `igs_test_`. It never reads `DATABASE_URL`, so tests cannot touch a dev or production database by accident.
