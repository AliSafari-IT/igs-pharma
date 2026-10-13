/**
 * One-shot migrate entry of the worker image (igs-pharma#46, IGS-D6): run it before the apps start,
 * as its own container, with a DDL-capable `DATABASE_URL` (the migrator role, not the worker's):
 *
 *   node dist/migrate.js
 *   (dev: pnpm --filter @igs/worker migrate)
 *
 * 1. Applies the committed Drizzle migrations (`packages/db/drizzle`, copied into the image as
 *    `/app/drizzle`), each once: the same chain and journal as `pnpm db:migrate` (migrations.md).
 * 2. Installs or upgrades pg-boss's `pgboss` schema (D-021): the production worker starts pg-boss
 *    with `migrate: false`, so this is the step that creates it.
 *
 * 3. Creates every pg-boss queue (`createQueue` is DDL, which the runtime roles lack): the kernel's,
 *    one per registered event topic, and the audit module's. The worker only checks they exist.
 * 4. Grants the worker role its runtime rights on `pgboss` (DML, no DDL; `igs_app` gets nothing),
 *    after everything above, so the grants cover the queue tables just created.
 *
 * It must run as the administrative role that owns the schemas (`DATABASE_MIGRATE_URL`, igs-pharma#66);
 * the runtime DSN is refused in production. Exits 0 when the database is up to date (running it again is a no-op), non-zero otherwise.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { adoptMigrateDsn, parseEnvFor, workerEnv } from "@igs/config/env";
import { closeDatabase, migrateDatabase } from "@igs/kernel";
import PgBoss from "pg-boss";

import { type InstallableBoss, installPgBossQueuesAndGrants } from "./pgboss-install";

/** `/app/drizzle` next to `/app/dist` in the image; the repository's folder under `tsx`. */
function migrationsFolder(): string {
  const candidates = ["../drizzle", "../../../packages/db/drizzle"].map((relative) =>
    fileURLToPath(new URL(relative, import.meta.url)),
  );
  const found = candidates.find((dir) => fs.existsSync(`${dir}/meta/_journal.json`));
  if (!found) throw new Error(`no migrations folder (looked in ${candidates.join(", ")})`);
  return found;
}

async function main() {
  let env: ReturnType<typeof parseEnvFor<typeof workerEnv>>;
  try {
    // the administrative role (DATABASE_MIGRATE_URL), never the runtime DSN (igs-pharma#66)
    adoptMigrateDsn();
    env = parseEnvFor(workerEnv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  const { logger } = await import("@igs/observability/logger");

  const folder = migrationsFolder();
  try {
    logger.info({ folder }, "Applying database migrations");
    await migrateDatabase(folder);
    logger.info("Database migrations applied");
  } finally {
    await closeDatabase();
  }

  // same connection settings as the worker (src/index.ts), but allowed to migrate its schema
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    max: 1,
    migrate: true,
    supervise: false,
    schedule: false,
    ssl: env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  });
  boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
  await boss.start();
  try {
    // getDb() is public in pg-boss 10 but missing from its typings
    await installPgBossQueuesAndGrants(boss as unknown as InstallableBoss);
    logger.info("pg-boss queues and runtime grants up to date");
  } finally {
    await boss.stop({ graceful: false, wait: true });
  }
  logger.info("pg-boss schema up to date");
}

main().catch(async (err: unknown) => {
  const { logger } = await import("@igs/observability/logger");
  logger.error({ err }, "Migration failed");
  process.exit(1);
});
