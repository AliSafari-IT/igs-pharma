/**
 * Synthetic catalogue seed (igs-pharma#50): loads the FAKE products and brands of
 * `synthetic-catalog.ts`, their demo stock (igs-pharma#53) and demo categories (igs-pharma#54), and
 * the demo prices of `synthetic-prices.ts` (igs-pharma#59), the demo orders of `synthetic-orders.ts`
 * and the demo privacy requests and consents of `synthetic-privacy.ts` (igs-pharma#58), so the
 * back-office can be tried on staging and in development.
 *
 *   NODE_ENV=development pnpm --filter @igs/worker seed-catalog                (dev)
 *   NODE_ENV=production IGS_ALLOW_SYNTHETIC_SEED=1 node dist/seed-catalog.js   (staging only)
 *
 * Runs only with an explicit `NODE_ENV=development` or with `IGS_ALLOW_SYNTHETIC_SEED=1`; a missing
 * `NODE_ENV` refuses. Safe to run twice (see `seedSyntheticCatalog`). Runs through the kernel as a
 * system actor holding `system_seed` (no user can hold it), so every write is audited like an
 * editor's.
 */
import {
  adoptMigrateDsn,
  parseEnvFor,
  syntheticSeedAllowed,
  syntheticSeedEnv,
  workerEnv,
} from "@igs/config/env";
import { checkDatabase, closeDatabase, configureKernel, isDomainError } from "@igs/kernel";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { registerAuditActions as registerCatalogAuditActions } from "@igs/module-catalog";
import {
  ensureRbacCatalogue,
  registerAuditActions as registerIdentityAuditActions,
} from "@igs/module-identity";
import { registerAuditActions as registerInventoryAuditActions } from "@igs/module-inventory";
import { registerAuditActions as registerOrdersAuditActions } from "@igs/module-orders";
import { registerAuditActions as registerPricingAuditActions } from "@igs/module-pricing";
import { registerAuditActions as registerPrivacyAuditActions } from "@igs/module-privacy";

import { registerWorkerEvents } from "./events";
import {
  PRODUCTS,
  cnkFor,
  seedSyntheticCatalog,
  seedSyntheticCategories,
  seedSyntheticStock,
} from "./synthetic-catalog";
import { seedSyntheticOrders } from "./synthetic-orders";
import { seedSyntheticPrices } from "./synthetic-prices";
import { seedSyntheticPrivacy } from "./synthetic-privacy";
import { seedSyntheticReservations } from "./synthetic-reservations";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const seedEnv = workerEnv.extend(syntheticSeedEnv.shape);

async function main() {
  let env: ReturnType<typeof parseEnvFor<typeof seedEnv>>;
  try {
    // a one-shot operator tool: it runs as the administrative role (igs-pharma#66)
    adoptMigrateDsn();
    env = parseEnvFor(seedEnv);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (!syntheticSeedAllowed(env)) {
    fail(
      "refused: set NODE_ENV=development, or IGS_ALLOW_SYNTHETIC_SEED=1 on staging only (never on the live shop).",
    );
  }

  registerIdentityAuditActions(registerAuditAction);
  registerCatalogAuditActions(registerAuditAction);
  registerInventoryAuditActions(registerAuditAction);
  registerPricingAuditActions(registerAuditAction);
  registerPrivacyAuditActions(registerAuditAction);
  registerOrdersAuditActions(registerAuditAction);
  configureKernel({ audit: createAuditPort() });
  registerWorkerEvents(); // the rejected demo order publishes its refund request
  try {
    await checkDatabase();
    await ensureRbacCatalogue();
    const { created, restored, skipped } = await seedSyntheticCatalog();
    process.stdout.write(
      `Synthetic catalogue: ${created} product(s) created, ${restored} given their status after an interrupted run, ${skipped} already there (CNK ${cnkFor(0)}–${cnkFor(PRODUCTS.length - 1)}).\n`,
    );
    const categories = await seedSyntheticCategories();
    process.stdout.write(
      `Demo categories: ${categories.created} created, ${categories.assigned} product(s) put in them, ${categories.skipped} left as they were.\n`,
    );
    const stock = await seedSyntheticStock();
    process.stdout.write(
      `Demo stock: ${stock.stocked} product(s) stocked, ${stock.skipped} left as they were.\n`,
    );
    const reservations = await seedSyntheticReservations();
    process.stdout.write(
      `Demo reservations: ${reservations.reserved} order(s) set aside, ${reservations.skipped} left as they were.\n`,
    );
    const prices = await seedSyntheticPrices();
    process.stdout.write(
      `Demo prices: ${prices.priced} product(s) priced, ${prices.scheduled} change(s) scheduled for tomorrow, ${prices.skipped} left as they were.\n`,
    );
    const orders = await seedSyntheticOrders();
    process.stdout.write(
      `Demo orders: ${orders.placed} placed, ${orders.skipped} left as they were.\n`,
    );
    const privacy = await seedSyntheticPrivacy();
    process.stdout.write(
      `Demo privacy data: ${privacy.requests} request(s) and ${privacy.consents} consent change(s) added, ${privacy.resumed} interrupted step(s) finished, ${privacy.skipped} left as they were.\n`,
    );
  } catch (error) {
    if (!isDomainError(error)) throw error;
    // not fail(): process.exit() would skip the finally below
    process.stderr.write(`refused: ${error.code}\n`);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
