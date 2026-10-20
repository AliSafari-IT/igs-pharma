import { ensureKernelQueues, grantPgBossRuntime } from "@igs/kernel";
import { ensureAuditQueues } from "@igs/module-audit";
import { ensureIdentityQueues } from "@igs/module-identity";
import { ensureInventoryQueues } from "@igs/module-inventory";
import { ensureOrdersQueues } from "@igs/module-orders";
import { ensurePrivacyQueues } from "@igs/module-privacy";

/** The slice of a started pg-boss that the migrate entry needs. */
export interface InstallableBoss {
  createQueue(
    name: string,
    options?: { retryLimit?: number; retryDelay?: number; deadLetter?: string },
  ): Promise<void>;
  getDb(): { executeSql(text: string, values?: unknown[]): Promise<unknown> };
}

/**
 * The pg-boss part of the migrate entry (igs-pharma#66), run as the administrative role right after
 * pg-boss installed its schema: create every queue (DDL, which the runtime roles lack), then grant
 * the worker role its runtime rights on `pgboss` (so the grants also cover the queue tables just
 * created). Modules that publish events register them before this call (none yet), so each topic
 * gets a queue. Idempotent: run on every deploy.
 */
export async function installPgBossQueuesAndGrants(boss: InstallableBoss): Promise<void> {
  await ensureKernelQueues(boss);
  await ensureAuditQueues(boss);
  await ensureIdentityQueues(boss);
  await ensureInventoryQueues(boss);
  await ensureOrdersQueues(boss);
  await ensurePrivacyQueues(boss);
  await grantPgBossRuntime(boss.getDb());
}
