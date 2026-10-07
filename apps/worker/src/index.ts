import { parseEnvFor, workerEnv } from "@igs/config/env";
import {
  type JobQueue,
  checkDatabase,
  closeDatabase,
  configureKernel,
  purgeExpired,
  startOutboxRelay,
} from "@igs/kernel";
import { type JobScheduler, createAuditPort, registerAuditJobs } from "@igs/module-audit";
import PgBoss from "pg-boss";

/** Hard stop if graceful shutdown hangs (e.g. a stuck connection). */
const SHUTDOWN_TIMEOUT_MS = 10_000;
const PURGE_QUEUE = "kernel.maintenance.purge";

async function main() {
  // Validate configuration first; fail fast with a readable message and a non-zero exit code.
  // The worker parses only what it uses: no AUTH_* (T-005b).
  let env: ReturnType<typeof parseEnvFor<typeof workerEnv>>;
  try {
    env = parseEnvFor(workerEnv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  // Imported after env validation so a bad environment never reaches logger setup.
  const { logger } = await import("@igs/observability/logger");
  logger.info({ nodeEnv: env.NODE_ENV }, "Worker starting");

  // Kernel composition root. The worker holds NO `AUDIT_HMAC_KEY`: its actors are system/webhook and
  // never carry an `origin`, so the port is built without a key and fails closed (audit.origin_without_key)
  // if one ever arrives. Audit action registrations of auditing modules go here, before configureKernel.
  configureKernel({ audit: createAuditPort(), logger });

  // Phase 0: verify DB connectivity
  await checkDatabase();
  logger.info("Database connection verified");

  // pg-boss owns its own `pgboss` schema. In production the worker role has no DDL rights, so
  // pg-boss must NOT migrate itself: its install/upgrade is a step of the migration job (D-021,
  // docs/06-engineering/migrations.md). In dev/test auto-migrating is fine.
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    max: 4,
    migrate: env.NODE_ENV !== "production",
    // mirrors @igs/db's `ssl: "require"`; explicit DATABASE_SSL handling arrives with B-08
    ssl: env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  });
  boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
  await boss.start();

  // Transactional outbox → pg-boss (at-least-once; subscribers use handleOnce).
  const relay = startOutboxRelay({
    queue: boss as unknown as JobQueue,
    logger,
  });
  // Daily housekeeping (K5): published outbox rows > 7 days, expired idempotency keys.
  await boss.createQueue(PURGE_QUEUE);
  await boss.schedule(PURGE_QUEUE, "17 3 * * *", undefined, { tz: "Europe/Brussels" });
  await boss.work(PURGE_QUEUE, async () => {
    const purged = await purgeExpired();
    logger.info(purged, "Kernel housekeeping done");
  });
  // Audit module (T-006b): daily partition maintenance (04:47) and chain verification (03:37,
  // Europe/Brussels), with pg-boss retries and dead-letter alarms. Brussels 02:xx is avoided (DST).
  await registerAuditJobs(boss as unknown as JobScheduler);
  // boss.work("<module>.<entity>.<past_tense>", handlers…) is registered here as modules land.

  // pg-boss's timers keep the loop alive, but hold the process open ourselves too so a stopped
  // relay can never exit silently; cleared on shutdown.
  const keepAlive = setInterval(() => {}, 1 << 30);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Worker shutting down gracefully");
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    clearInterval(keepAlive);
    try {
      await relay.stop();
      await boss.stop({ graceful: true, wait: true, timeout: SHUTDOWN_TIMEOUT_MS / 2 });
      await closeDatabase();
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
