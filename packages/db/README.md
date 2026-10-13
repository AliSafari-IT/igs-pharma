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

## Runtime roles and grants (igs-pharma#66, D-036)

The apps and the worker connect as **unprivileged runtime roles**; an **administrative role owns the
schemas** and is the only one that runs DDL. This is code, not server folklore:

| Role | Used by | May |
|---|---|---|
| administrative (`DATABASE_MIGRATE_URL`) | migrate entry, `pnpm db:migrate`, `bootstrap-owner`, `seed-catalog` | owns every object; DDL |
| `igs_app` (group; a login is a member) | web, platform | the DML listed in the manifest; never DDL, never `UPDATE`/`DELETE` on an append-only ledger |
| `igs_worker` (group; the worker's login is a member of **both** groups) | worker | `igs_app` plus the worker-only grants (purge `DELETE`, `audit.maintain_partitions()`, `pgboss` DML) |

- **The manifest** is `src/grants/<schema>.ts` (one file per schema, no module import: D-001). It is
  the single source of truth for the tests and is rendered into migration `0026_runtime_grants` by
  `pnpm db:grants:generate`; `test/grants-sql.test.ts` fails when the committed SQL differs from the
  generator output. A later table gets `since: <migration number>` on its manifest entry, its own
  migration (`drizzle-kit generate --custom`) and `pnpm db:grants:generate <number>` renders that
  migration's `GRANT`s. The migration is idempotent: it resets PUBLIC and the runtime roles in each
  schema and grants exactly the manifest, so it converges on a database whose grants were made by
  hand. It STARTS with an assertion that lists (and never fixes) objects owned by a runtime role or
  by a member of one (including `pgboss`) and powerful role attributes, so a non-superuser
  administrator gets the offender list instead of a bare `permission denied`.
- **A new table or function fails `test/grants.test.ts` until it has a manifest entry** (the drift
  test), and gets its grants in **its own migration** (no `ALTER DEFAULT PRIVILEGES`, no `PUBLIC`).
  Add the entry to the module's schema file and write the `GRANT`s next to the `CREATE TABLE`
  (`renderGrantsSql` can print them). The same test compares every privilege in both directions.
- **Events**: the worker and the migrate entry both call `registerWorkerEvents()` (`apps/worker/src/events.ts`);
  the migrate entry creates one queue per registered topic. Adding an event means re-running the
  migrate entry before starting the new worker.
- **pg-boss**: its schema is installed by the migrate entry (the administrator owns it), which also
  creates every queue (DDL) and grants the worker its DML (`renderPgbossGrantsSql`). The worker only
  checks that its queues exist (`kernel.queue_missing`).
- **Login roles** are created outside the repo, by the host administrator, with the secret-free
  `infra/db/create-login-roles.sql` (passwords are set with `\password`).
- **Tests**: `createRuntimeRoleDatabase()` (`@igs/db/testing`) migrates as a non-superuser
  administrator and hands out connections as members of the two groups.

## TLS to PostgreSQL and the migrate lock (igs-pharma#77)

- **One TLS rule for every connection** (`buildDbSsl()` in `@igs/config/db-ssl`): the `@igs/db` client
  (web, platform, worker, bootstrap-owner, seed-catalog), the worker's and the migrate entry's pg-boss
  instances and `drizzle.config.ts`. `DATABASE_SSL=verify` checks the certificate chain and host name
  against the system trust store plus the optional `DATABASE_SSL_CA` (PEM or a file path); it is the
  default in production, where `off` is refused. `insecure-dev` encrypts without verifying and is an
  explicit opt-in (one warning on stderr in production; the CI smoke run uses it against its
  self-signed Postgres). Outside production the default is plain TCP. A CA setting that is set but
  unusable fails at first use with a readable message; neither the DSN nor the CA is ever logged.
- **The migrate entry holds a session-level advisory lock** (`withAdvisoryLock`, key
  `MIGRATE_LOCK_KEY`) around Drizzle migrations, the pg-boss install, queue creation and the grants:
  two concurrent starts serialise. It lives on its own connection, is released in `finally` (or by
  Postgres when the process dies) and a waiter gives up after ten minutes with a readable message.
- **`pnpm db:check`** also checks the journal (`checkJournal`): `idx` without gaps, `when` strictly
  increasing (Drizzle silently skips an entry that is not newer than the last applied one), every
  entry has its SQL and snapshot, no orphan SQL file.
