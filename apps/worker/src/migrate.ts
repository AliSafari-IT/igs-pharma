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
 * Exits 0 when the database is up to date (running it again is a no-op), non-zero otherwise.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { parseEnvFor, workerEnv } from "@igs/config/env";
import { closeDatabase, migrateDatabase } from "@igs/kernel";
import PgBoss from "pg-boss";

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
  await boss.stop({ graceful: false, wait: true });
  logger.info("pg-boss schema up to date");
}

main().catch(async (err: unknown) => {
  const { logger } = await import("@igs/observability/logger");
  logger.error({ err }, "Migration failed");
  process.exit(1);
});
