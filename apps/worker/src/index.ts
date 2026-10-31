import { buildDbSsl } from "@igs/config/db-ssl";
import { parseEnvFor, workerEnv } from "@igs/config/env";
import {
  type JobQueue,
  PURGE_QUEUE,
  assertQueuesExist,
  checkDatabase,
  closeDatabase,
  configureKernel,
  purgeExpired,
  startOutboxRelay,
} from "@igs/kernel";
import {
  type JobScheduler,
  createAuditPort,
  registerAuditAction,
  registerAuditJobs,
} from "@igs/module-audit";
import {
  type IdentityJobScheduler,
  ensureRbacCatalogue,
  registerAuditActions as registerIdentityAuditActions,
  registerIdentityJobs,
} from "@igs/module-identity";
import {
  type InventoryJobScheduler,
  registerAuditActions as registerInventoryAuditActions,
  registerInventoryJobs,
} from "@igs/module-inventory";
import {
  type OrderMailJobScheduler,
  type OrdersJobScheduler,
  registerOrderMailJobs,
  registerAuditActions as registerOrdersAuditActions,
  registerOrdersJobs,
} from "@igs/module-orders";
import {
  type PrivacyJobScheduler,
  registerAuditActions as registerPrivacyAuditActions,
  registerPrivacyJobs,
} from "@igs/module-privacy";
import { createMollieClient } from "@igs/payments";
import PgBoss from "pg-boss";

import { registerWorkerEvents } from "./events";
import { createMailSender, createOrderMailSender } from "./mail-sender";

/** Hard stop if graceful shutdown hangs (e.g. a stuck connection). */
const SHUTDOWN_TIMEOUT_MS = 10_000;

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
  registerIdentityAuditActions(registerAuditAction);
  registerPrivacyAuditActions(registerAuditAction); // the retention purge audits its counts
  registerInventoryAuditActions(registerAuditAction); // the reservation expiry audits each hold it ends
  registerOrdersAuditActions(registerAuditAction); // payment reconciliation and unpaid-order expiry
  configureKernel({ audit: createAuditPort(), logger });
  registerWorkerEvents(); // the topics the relay publishes; migrate creates their queues (./events)

  // Phase 0: verify DB connectivity
  await checkDatabase();
  logger.info("Database connection verified");

  // T-016: load the RBAC catalogue once, at boot, and check it against the code. A drifted
  // database (a missing seed migration) stops the worker here instead of authorizing wrongly.
  await ensureRbacCatalogue();
  logger.info("RBAC catalogue loaded");

  // pg-boss owns its own `pgboss` schema. In production the worker role has no DDL rights, so
  // pg-boss must NOT migrate itself: its install/upgrade is a step of the migration job (D-021,
  // asafarim-docs:ventures/igs-pharma/06-engineering/migrations.md). In dev/test auto-migrating is fine.
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    max: 4,
    migrate: env.NODE_ENV !== "production",
    // the same TLS rule as every other connection: verified in production (igs-pharma#77)
    ssl: buildDbSsl(env).options,
  });
  boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
  await boss.start();

  // Transactional outbox → pg-boss (at-least-once; subscribers use handleOnce).
  const relay = startOutboxRelay({
    queue: boss as unknown as JobQueue,
    logger,
  });
  // Daily housekeeping (K5): published outbox rows > 7 days, expired idempotency keys.
  // queues are created by the migrate entry (DDL); the worker only checks they exist (igs-pharma#66)
  await assertQueuesExist(boss, [PURGE_QUEUE]);
  await boss.schedule(PURGE_QUEUE, "17 3 * * *", undefined, { tz: "Europe/Brussels" });
  await boss.work(PURGE_QUEUE, async () => {
    const purged = await purgeExpired();
    logger.info(purged, "Kernel housekeeping done");
  });
  // Audit module (T-006b): daily partition maintenance (04:47) and chain verification (03:37,
  // Europe/Brussels), with pg-boss retries and dead-letter alarms. Brussels 02:xx is avoided (DST).
  await registerAuditJobs(boss as unknown as JobScheduler);
  // Housekeeping that deletes through narrow definer functions (igs-pharma#88): expired import plans
  // (04:12) and personal data past its retention period (03:52), Europe/Brussels, never 02:xx.
  await registerInventoryJobs(boss as unknown as InventoryJobScheduler);
  await registerPrivacyJobs(boss as unknown as PrivacyJobScheduler);
  // igs-pharma#116: expired carts and month-old checkouts (04:27 Europe/Brussels), a definer function;
  // every 5 minutes, Mollie payments whose webhook never came are re-read and orders unpaid for 24 h
  // expire. igs-pharma#156: `orders.refund.requested` events are executed at Mollie (and re-run by the
  // reconciliation while unsettled). Without MOLLIE_API_KEY only the expiry runs; refunds wait.
  await registerOrdersJobs(
    boss as unknown as OrdersJobScheduler,
    undefined,
    env.MOLLIE_API_KEY ? createMollieClient(env.MOLLIE_API_KEY) : null,
  );
  // Account mail (igs-pharma#114): the worker is the only process that talks to a mail server (D-019).
  // `identity.mail.requested` events arrive through the outbox; expired links are purged hourly.
  // igs-pharma#199: the early-access staff notice goes to EARLY_ACCESS_NOTIFY_TO; ended requests are
  // purged daily after 12 months.
  await registerIdentityJobs(
    boss as unknown as IdentityJobScheduler,
    createMailSender(env),
    undefined,
    { staffRecipients: env.EARLY_ACCESS_NOTIFY_TO ?? [] },
  );
  // Order mails (igs-pharma#157): `orders.mail.requested` events, each tied to the order's state.
  await registerOrderMailJobs(boss as unknown as OrderMailJobScheduler, createOrderMailSender(env));
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
