/**
 * The manual SAM import (igs-pharma#237): the same import the weekly job runs, on demand, for a
 * first run or a check. Runs as the worker (its runtime role) and the `system_catalog_import`
 * system actor; writes draft products only and one audit event per run.
 *
 *   pnpm --filter @igs/worker sam-import --dry-run                    (dev; SAM_EXPORT_URL)
 *   pnpm --filter @igs/worker sam-import --file ./export.zip --dry-run
 *   node dist/sam-import.js [--file <export.zip>] [--dry-run]         (the worker image)
 *
 * `--dry-run` parses and maps without writing anything (no product, no audit event) and prints the
 * counts plus how many packs carry each `DeliveryModus` code: use it to confirm
 * `SAM_OTC_DELIVERY_MODUS_CODES` before the first real run. Prints counts and codes only, never XML.
 */
import { parseEnvFor, workerEnv } from "@igs/config/env";
import { checkDatabase, closeDatabase, configureKernel } from "@igs/kernel";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { registerAuditActions as registerCatalogAuditActions } from "@igs/module-catalog";
import { runSamImportFrom } from "@igs/module-catalog";
import { ensureRbacCatalogue } from "@igs/module-identity";

import { parseSamImportArgs, samExportOpener } from "./sam-export";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main() {
  let args: ReturnType<typeof parseSamImportArgs>;
  let env: ReturnType<typeof parseEnvFor<typeof workerEnv>>;
  try {
    args = parseSamImportArgs(process.argv.slice(2));
    env = parseEnvFor(workerEnv);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const openExport = samExportOpener({
    file: args.file,
    url: env.SAM_EXPORT_URL,
    maxBytes: env.SAM_EXPORT_MAX_BYTES,
  });
  if (openExport === null)
    fail("Nothing to import: pass --file <export.zip> or set SAM_EXPORT_URL.");

  const { logger } = await import("@igs/observability/logger");
  registerCatalogAuditActions(registerAuditAction);
  configureKernel({ audit: createAuditPort(), logger });
  try {
    await checkDatabase();
    await ensureRbacCatalogue();
    const report = await runSamImportFrom(openExport, {
      otcDeliveryModusCodes: env.SAM_OTC_DELIVERY_MODUS_CODES,
      dryRun: args.dryRun,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (env.SAM_OTC_DELIVERY_MODUS_CODES.length === 0) {
      process.stdout.write(
        "SAM_OTC_DELIVERY_MODUS_CODES is empty: every pack counted as on prescription (fail closed).\n",
      );
    }
  } finally {
    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `SAM import failed: ${error instanceof Error ? ((error as { code?: string }).code ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
