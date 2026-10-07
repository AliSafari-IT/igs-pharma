import { getEnv } from "@igs/config/env";
import { getDb } from "@igs/db/client";
import { logger } from "@igs/observability/logger";
import { sql } from "drizzle-orm";

async function main() {
  const env = getEnv();
  logger.info({ nodeEnv: env.NODE_ENV }, "Worker starting");

  // Phase 0: verify DB connectivity
  const db = getDb();
  await db.execute(sql`SELECT 1`);
  logger.info("Database connection verified");

  // Phase 1: register pg-boss jobs here
  // const boss = new PgBoss(env.DATABASE_URL);
  // await boss.start();
  // boss.work("catalog.import", handlers.catalogImport);

  logger.info("Worker ready — waiting for jobs");
  process.on("SIGTERM", gracefulShutdown);
  process.on("SIGINT", gracefulShutdown);
}

function gracefulShutdown() {
  logger.info("Worker shutting down gracefully");
  process.exit(0);
}

main().catch((err: unknown) => {
  logger.error({ err }, "Worker startup failed");
  process.exit(1);
});
