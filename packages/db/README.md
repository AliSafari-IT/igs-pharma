# @igs/db

Drizzle client, ID helper, test harness and migrations. **Owns no tables** (D-017).

## Where tables live (D-001)

- A **module owns its tables**: `packages/modules/<name>/src/schema.ts`, in its own Postgres schema (`pgSchema("<name>")`). Nobody else queries them.
- The kernel owns the `system` schema (`packages/kernel/src/schema.ts`: `system.idempotency_keys`, and `system.outbox` from T-005b), so `packages/db` itself owns **no tables** (D-017).
- `packages/db` **never imports modules** (`db ↛ modules`). `drizzle.config.ts` aggregates by **path glob only**:

  ```ts
  schema: ["../modules/*/src/schema.ts", "../kernel/src/schema.ts"]
  ```

  A glob in a config file is not an import, so the dependency rule holds. A new module's schema is picked up automatically — no change here.

## Conventions (D-003)

- Primary keys are UUIDv7 generated app-side: `newId()` from `@igs/db/ids` (backed by the small `uuidv7` package). Use `uuid("id").primaryKey().$defaultFn(() => newId())`.
- Timestamps are `timestamptz`; money is integer cents + currency.
- `@igs/db/ids` is a pure file on purpose: schema files import it and are loaded by drizzle-kit, so it must not pull in `server-only` or env.

## Using the test harness from another package

`@igs/db/testing` (+ `/testing/global-setup`) is test-only. pnpm only exposes a package's *direct*
dependencies, so a package that uses the harness lists `@testcontainers/postgresql` and `postgres` as
devDependencies and points Vitest at it: `test.globalSetup: ["@igs/db/testing/global-setup"]`
(see `packages/kernel/vitest.config.ts`).

## Migrations

```bash
pnpm db:generate     # diff schema → new SQL file in packages/db/drizzle
pnpm db:migrate      # apply to DATABASE_URL (idempotent; applying twice is a no-op)
```

- `0000_extensions.sql` is a hand-written custom migration (`drizzle-kit generate --custom`) enabling `citext`. Extensions go in custom migrations *before* the tables that need them.
- Never edit an applied migration; add a new one.
- `db:*` tasks run through turbo with `passThroughEnv` for `DATABASE_URL` etc.
