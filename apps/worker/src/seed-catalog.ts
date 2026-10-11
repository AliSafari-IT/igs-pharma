/**
 * Synthetic catalogue seed (igs-pharma#50): loads the FAKE products and brands of
 * `synthetic-catalog.ts`, so the back-office can be tried on staging and in development.
 *
 *   NODE_ENV=development pnpm --filter @igs/worker seed-catalog                (dev)
 *   NODE_ENV=production IGS_ALLOW_SYNTHETIC_SEED=1 node dist/seed-catalog.js   (staging only)
 *
 * Runs only with an explicit `NODE_ENV=development` or with `IGS_ALLOW_SYNTHETIC_SEED=1`; a missing
 * `NODE_ENV` refuses. Safe to run twice (see `seedSyntheticCatalog`). Runs through the kernel as a
 * system actor holding `system_seed` (no user can hold it), so every write is audited like an
 * editor's.
 */
import { parseEnvFor, syntheticSeedAllowed, syntheticSeedEnv, workerEnv } from "@igs/config/env";
import { checkDatabase, closeDatabase, configureKernel, isDomainError } from "@igs/kernel";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { registerAuditActions as registerCatalogAuditActions } from "@igs/module-catalog";
import {
  ensureRbacCatalogue,
  registerAuditActions as registerIdentityAuditActions,
} from "@igs/module-identity";

import { PRODUCTS, cnkFor, seedSyntheticCatalog } from "./synthetic-catalog";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const seedEnv = workerEnv.extend(syntheticSeedEnv.shape);

async function main() {
  let env: ReturnType<typeof parseEnvFor<typeof seedEnv>>;
  try {
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
  configureKernel({ audit: createAuditPort() });
  try {
    await checkDatabase();
    await ensureRbacCatalogue();
    const { created, restored, skipped } = await seedSyntheticCatalog();
    process.stdout.write(
      `Synthetic catalogue: ${created} product(s) created, ${restored} given their status after an interrupted run, ${skipped} already there (CNK ${cnkFor(0)}–${cnkFor(PRODUCTS.length - 1)}).\n`,
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
