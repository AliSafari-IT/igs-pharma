import { newId } from "@igs/db/ids";
import {
  type Actor,
  type Ctx,
  type KernelRuntime,
  command,
  getKernelRuntime,
  isDomainError,
} from "@igs/kernel";
import { PERMISSIONS } from "@igs/rbac";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { CATALOG_AUDIT } from "../audit";
import { isUniqueViolation } from "../concurrency";
import { CNK_PATTERN } from "../domain";
import { productContent, products } from "../schema";
import {
  SAM_NAME_MAX,
  SAM_SKIP_REASONS,
  type SamImportRow,
  type SamSkipReason,
  brusselsToday,
  mapAmp,
} from "./map";
import { parseSamAmps } from "./parse";
import { samRunAudit } from "./report";

/**
 * The SAM import (igs-pharma#237): AMPP rows → `catalog.products` + `catalog.product_content`, by
 * CNK, through two kernel commands. Rules (see the catalog README, "SAM import"):
 *
 * - a new CNK becomes a `draft` OTC medicine (`otc_medicine` / `otc` / `BE_6`) flagged for
 *   pharmacist review, with unapproved `sam` texts; the import never activates anything;
 * - an existing product never has its status or a regulated field changed; when its type, legal
 *   status or VAT class differ from what SAM implies it counts as a `conflict` and nothing is written;
 * - a `manual` or `medipim` text is never overwritten; a `sam` text is refreshed (approval cleared);
 * - a GTIN is stored only when valid and unused, and only on a product that has none;
 * - a second run of the same file writes nothing (`unchanged`; the version only moves on a change).
 *
 * D-019: the handlers only touch the database. The download, the temp file and the unzip happen in
 * the worker, which hands `runSamImport` the XML as a stream of chunks.
 */

/** Rows per transaction (one `catalog.sam_import.batch` call). */
export const SAM_BATCH_SIZE = 500;

/** The values a new SAM product gets (regulated: a pharmacist reviews them before activation). */
export const SAM_NEW_PRODUCT = {
  productType: "otc_medicine",
  legalStatus: "otc",
  vatClass: "BE_6",
  requiresPharmacistReview: true,
  ageMin: null,
} as const;

/** The worker's import actor: `system_catalog_import` is a system role no user can hold. */
export const SAM_IMPORT_ACTOR: Actor = {
  type: "system",
  id: "sam-import-job",
  roles: ["system_catalog_import"],
};

const name = z.string().trim().min(1).max(SAM_NAME_MAX);
const rowInput = z.object({
  cnk: z.string().regex(CNK_PATTERN),
  gtin: z
    .string()
    .regex(/^[0-9]{14}$/)
    .nullable(),
  gtinInvalid: z.boolean(),
  names: z.object({ nl: name, fr: name, de: name.optional() }),
});

const batchCounts = z.object({
  created: z.number().int().min(0),
  updated: z.number().int().min(0),
  unchanged: z.number().int().min(0),
  conflicts: z.number().int().min(0),
  gtinTaken: z.number().int().min(0),
  gtinKept: z.number().int().min(0),
  textsKept: z.number().int().min(0),
});
export type SamBatchCounts = z.infer<typeof batchCounts>;

const zeroBatch = (): SamBatchCounts => ({
  created: 0,
  updated: 0,
  unchanged: 0,
  conflicts: 0,
  gtinTaken: 0,
  gtinKept: 0,
  textsKept: 0,
});

/** The unique constraint on `catalog.products.gtin`. */
const GTIN_UNIQUE = "products_gtin_unique";

async function gtinFree(ctx: Ctx, gtin: string, productId?: string): Promise<boolean> {
  const [taken] = await ctx.tx
    .select({ id: products.id })
    .from(products)
    .where(
      productId === undefined
        ? eq(products.gtin, gtin)
        : and(eq(products.gtin, gtin), ne(products.id, productId)),
    );
  return taken === undefined;
}

type Locale = "nl" | "fr" | "de";
const localesOf = (row: SamImportRow): [Locale, string][] =>
  (["nl", "fr", "de"] as const).flatMap((locale) => {
    const text = row.names[locale];
    return text === undefined ? [] : [[locale, text] as [Locale, string]];
  });

async function insertSamText(ctx: Ctx, productId: string, locale: Locale, text: string) {
  await ctx.tx.insert(productContent).values({
    productId,
    locale,
    name: text,
    source: "sam",
    approvedBy: null,
    approvedAt: null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  });
}

async function createFromSam(
  ctx: Ctx,
  row: SamImportRow,
  counts: SamBatchCounts,
): Promise<boolean> {
  let gtin = row.gtin;
  if (gtin !== null && !(await gtinFree(ctx, gtin))) {
    counts.gtinTaken++;
    gtin = null;
  }
  const insert = (value: string | null) =>
    ctx.tx.transaction((sp) =>
      sp
        .insert(products)
        .values({
          cnk: row.cnk,
          gtin: value,
          status: "draft",
          coldChain: false,
          ...SAM_NEW_PRODUCT,
        })
        .onConflictDoNothing({ target: products.cnk })
        .returning({ id: products.id }),
    );
  let created: { id: string }[];
  try {
    created = await insert(gtin); // a savepoint: a lost GTIN race is a count, not an error
  } catch (error) {
    if (!isUniqueViolation(error, GTIN_UNIQUE)) throw error;
    counts.gtinTaken++;
    created = await insert(null);
  }
  const product = created[0];
  if (!product) return false; // the CNK appeared meanwhile: the caller treats it as existing
  for (const [locale, text] of localesOf(row)) await insertSamText(ctx, product.id, locale, text);
  counts.created++;
  return true;
}

async function upsertRow(ctx: Ctx, row: SamImportRow, counts: SamBatchCounts): Promise<void> {
  const select = () =>
    ctx.tx
      .select({
        id: products.id,
        gtin: products.gtin,
        version: products.version,
        productType: products.productType,
        legalStatus: products.legalStatus,
        vatClass: products.vatClass,
      })
      .from(products)
      .where(eq(products.cnk, row.cnk))
      .for("update");
  let [current] = await select();
  if (!current) {
    if (await createFromSam(ctx, row, counts)) return;
    [current] = await select();
    if (!current) throw new Error("catalog.sam_import.cnk_vanished");
  }

  // regulated values are a pharmacist's: never written here; a disagreement is reported, not fixed
  if (
    current.productType !== SAM_NEW_PRODUCT.productType ||
    current.legalStatus !== SAM_NEW_PRODUCT.legalStatus ||
    current.vatClass !== SAM_NEW_PRODUCT.vatClass
  ) {
    counts.conflicts++;
    return;
  }

  let changed = false;
  let gtin: string | null = current.gtin;
  if (row.gtin !== null) {
    if (current.gtin === null) {
      if (await gtinFree(ctx, row.gtin, current.id)) {
        gtin = row.gtin;
        changed = true;
      } else counts.gtinTaken++;
    } else if (current.gtin !== row.gtin) counts.gtinKept++;
  }

  const existing = new Map(
    (
      await ctx.tx
        .select({
          locale: productContent.locale,
          name: productContent.name,
          source: productContent.source,
        })
        .from(productContent)
        .where(eq(productContent.productId, current.id))
    ).map((r) => [r.locale, r]),
  );
  for (const [locale, text] of localesOf(row)) {
    const before = existing.get(locale);
    if (!before) {
      await insertSamText(ctx, current.id, locale, text);
      changed = true;
    } else if (before.source !== "sam") {
      counts.textsKept++; // a person's or Medipim's text wins over SAM
    } else if (before.name !== text) {
      await ctx.tx
        .update(productContent)
        .set({ name: text, approvedBy: null, approvedAt: null, updatedAt: ctx.now })
        .where(
          and(
            eq(productContent.productId, current.id),
            eq(productContent.locale, locale),
            eq(productContent.source, "sam"),
          ),
        );
      changed = true;
    }
  }

  if (!changed) {
    counts.unchanged++;
    return;
  }
  try {
    await ctx.tx.transaction((sp) =>
      sp
        .update(products)
        .set({ gtin, version: current.version + 1, updatedAt: ctx.now })
        .where(eq(products.id, current.id)),
    );
  } catch (error) {
    if (!isUniqueViolation(error, GTIN_UNIQUE)) throw error;
    counts.gtinTaken++; // lost a GTIN race: keep the texts, leave the GTIN empty
    await ctx.tx
      .update(products)
      .set({ version: current.version + 1, updatedAt: ctx.now })
      .where(eq(products.id, current.id));
  }
  counts.updated++;
}

/**
 * Upserts up to `SAM_BATCH_SIZE` rows in ONE transaction. Internal (a system actor only) and without
 * its own audit record: the run writes one `catalog.sam_import.completed` event with the counts.
 */
export const importSamBatch = command({
  name: "catalog.sam_import.batch",
  input: z.object({ rows: z.array(rowInput).min(1).max(SAM_BATCH_SIZE) }),
  output: batchCounts,
  permission: PERMISSIONS.catalog.productsImport,
  internal: true,
  audit: "none",
  async handler({ input, ctx }) {
    const counts = zeroBatch();
    for (const row of input.rows) await upsertRow(ctx, row, counts);
    return counts;
  },
});

/** Writes the run's ONE audit event (counts only). */
export const recordSamImportRun = command({
  name: "catalog.sam_import.record_run",
  input: samRunAudit,
  output: z.object({ runId: z.uuid() }),
  permission: PERMISSIONS.catalog.productsImport,
  internal: true,
  async handler({ input, ctx }) {
    await ctx.audit.record({
      action: CATALOG_AUDIT.samImportCompleted,
      entityType: "sam_import",
      entityId: input.runId,
      data: input,
    });
    return { runId: input.runId };
  },
});

export interface SamImportReport extends SamBatchCounts {
  readonly runId: string;
  readonly dryRun: boolean;
  outcome: "completed" | "aborted";
  /** AMPPs read. */
  read: number;
  /** AMPPs that became import rows (OTC, named, marketed); in a dry run, what would be written. */
  rows: number;
  withdrawn: number;
  failed: number;
  gtinInvalid: number;
  readonly skipped: Record<SamSkipReason, number>;
  /** How many AMPPs carried each `DeliveryModus` code (to confirm the OTC list; codes, not data). */
  readonly deliveryModus: Record<string, number>;
}

export interface SamImportOptions {
  readonly otcDeliveryModusCodes: Iterable<string>;
  /** Parse and map only; write nothing (no products, no audit event). */
  readonly dryRun?: boolean;
  readonly now?: Date;
  readonly actor?: Actor;
  readonly batchSize?: number;
  readonly runtime?: KernelRuntime;
}

const addBatch = (report: SamImportReport, counts: SamBatchCounts) => {
  for (const key of Object.keys(counts) as (keyof SamBatchCounts)[]) report[key] += counts[key];
};

/** The report as `samRunAudit` stores it. */
export function auditCounts(report: SamImportReport): z.infer<typeof samRunAudit> {
  return {
    runId: report.runId,
    outcome: report.outcome,
    read: report.read,
    rows: report.rows,
    created: report.created,
    updated: report.updated,
    unchanged: report.unchanged,
    withdrawn: report.withdrawn,
    conflicts: report.conflicts,
    failed: report.failed,
    gtinInvalid: report.gtinInvalid,
    gtinTaken: report.gtinTaken,
    gtinKept: report.gtinKept,
    textsKept: report.textsKept,
    ...Object.fromEntries(SAM_SKIP_REASONS.map((r) => [`skipped_${r}`, report.skipped[r]])),
  } as z.infer<typeof samRunAudit>;
}

/**
 * Reads the AMP export from `chunks`, maps every AMPP and imports the rows in batches. A failed
 * batch is retried row by row, so one bad row is counted as `failed` and never stops the run. Ends
 * with ONE audit event (unless `dryRun`), also when the stream breaks half-way (`aborted`, then
 * rethrown). Logs the counts; never XML, never a text.
 */
export async function runSamImport(
  chunks: AsyncIterable<string | Uint8Array>,
  options: SamImportOptions,
): Promise<SamImportReport> {
  const runtime = options.runtime ?? getKernelRuntime();
  const actor = options.actor ?? SAM_IMPORT_ACTOR;
  const dryRun = options.dryRun ?? false;
  const batchSize = Math.min(options.batchSize ?? SAM_BATCH_SIZE, SAM_BATCH_SIZE);
  const mapOptions = {
    today: brusselsToday(options.now ?? new Date()),
    otcDeliveryModusCodes: new Set(options.otcDeliveryModusCodes),
  };
  const report: SamImportReport = {
    runId: newId(),
    dryRun,
    outcome: "completed",
    read: 0,
    rows: 0,
    withdrawn: 0,
    failed: 0,
    gtinInvalid: 0,
    ...zeroBatch(),
    skipped: Object.fromEntries(SAM_SKIP_REASONS.map((r) => [r, 0])) as Record<
      SamSkipReason,
      number
    >,
    deliveryModus: {},
  };

  let batch: SamImportRow[] = [];
  const flush = async () => {
    const rows = batch;
    batch = [];
    if (rows.length === 0 || dryRun) return;
    try {
      addBatch(report, await importSamBatch({ rows }, actor));
    } catch {
      for (const row of rows) {
        try {
          addBatch(report, await importSamBatch({ rows: [row] }, actor));
        } catch (error) {
          report.failed++;
          runtime.logger.warn?.(
            { cnk: row.cnk, code: isDomainError(error) ? error.code : "error" },
            "catalog.sam_import.row_failed",
          );
        }
      }
    }
  };

  try {
    for await (const amp of parseSamAmps(chunks)) {
      for (const outcome of mapAmp(amp, mapOptions)) {
        report.read++;
        if (outcome.deliveryModus !== undefined) {
          report.deliveryModus[outcome.deliveryModus] =
            (report.deliveryModus[outcome.deliveryModus] ?? 0) + 1;
        }
        if (outcome.kind === "skip") report.skipped[outcome.reason]++;
        else if (outcome.kind === "withdrawn") report.withdrawn++;
        else {
          report.rows++;
          if (outcome.row.gtinInvalid) report.gtinInvalid++;
          batch.push(outcome.row);
          if (batch.length >= batchSize) await flush();
        }
      }
    }
    await flush();
  } catch (error) {
    report.outcome = "aborted";
    if (!dryRun) await recordSamImportRun(auditCounts(report), actor);
    runtime.logger.warn?.({ ...auditCounts(report), dryRun }, "catalog.sam_import.aborted");
    throw error;
  }
  if (!dryRun) await recordSamImportRun(auditCounts(report), actor);
  runtime.logger.info?.(
    { ...auditCounts(report), dryRun, deliveryModus: report.deliveryModus },
    "catalog.sam_import.done",
  );
  return report;
}
