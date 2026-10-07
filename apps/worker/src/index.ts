import { getEnv } from "@igs/config/env";
import { closeDb, getDb } from "@igs/db/client";
import { sql } from "drizzle-orm";

/** Hard stop if graceful shutdown hangs (e.g. a stuck connection). */
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main() {
  // Validate configuration first; fail fast with a readable message and a non-zero exit code.
  let env: ReturnType<typeof getEnv>;
  try {
    env = getEnv();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  // Imported after env validation so a bad environment never reaches logger setup.
  const { logger } = await import("@igs/observability/logger");
  logger.info({ nodeEnv: env.NODE_ENV }, "Worker starting");

  // Phase 0: verify DB connectivity
  const db = getDb();
  await db.execute(sql`SELECT 1`);
  logger.info("Database connection verified");

  // Phase 1: register pg-boss jobs here (T-005 outbox relay)
  // const boss = new PgBoss(env.DATABASE_URL);
  // await boss.start();
  // boss.work("catalog.import", handlers.catalogImport);

  // Until pg-boss is wired nothing else keeps the event loop alive (the pool closes idle
  // connections), so hold the process open ourselves; cleared on shutdown.
  const keepAlive = setInterval(() => {}, 1 << 30);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Worker shutting down gracefully");
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    clearInterval(keepAlive);
    try {
      // Phase 1: stop accepting jobs first — await boss.stop({ graceful: true });
      await closeDb();
      logger.info("Worker stopped");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Worker shutdown failed");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  logger.info("Worker ready — waiting for jobs");
}

main().catch(async (err: unknown) => {
  const { logger } = await import("@igs/observability/logger");
  logger.error({ err }, "Worker startup failed");
  process.exit(1);
});
