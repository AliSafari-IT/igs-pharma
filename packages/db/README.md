# @igs/db

Drizzle client, shared tables, ID helper and migrations.

## Where tables live (D-001)

- A **module owns its tables**: `packages/modules/<name>/src/schema.ts`, in its own Postgres schema (`pgSchema("<name>")`). Nobody else queries them.
- `packages/db/src/schema/shared.ts` holds the few cross-module tables (e.g. `idempotency_keys`).
- `packages/db` **never imports modules** (`db ↛ modules`). `drizzle.config.ts` aggregates by **path glob only**:

  ```ts
  schema: ["./src/schema/shared.ts", "../modules/*/src/schema.ts"]
  ```

  A glob in a config file is not an import, so the dependency rule holds. A new module's schema is picked up automatically — no change here.

## Conventions (D-003)

- Primary keys are UUIDv7 generated app-side: `newId()` from `@igs/db/ids` (backed by the small `uuidv7` package). Use `uuid("id").primaryKey().$defaultFn(() => newId())`.
- Timestamps are `timestamptz`; money is integer cents + currency.
- `@igs/db/ids` is a pure file on purpose: schema files import it and are loaded by drizzle-kit, so it must not pull in `server-only` or env.

## Migrations

```bash
pnpm db:generate     # diff schema → new SQL file in packages/db/drizzle
pnpm db:migrate      # apply to DATABASE_URL (idempotent; applying twice is a no-op)
```

- `0000_extensions.sql` is a hand-written custom migration (`drizzle-kit generate --custom`) enabling `citext`. Extensions go in custom migrations *before* the tables that need them.
- Never edit an applied migration; add a new one.
- `db:*` tasks run through turbo with `passThroughEnv` for `DATABASE_URL` etc.
