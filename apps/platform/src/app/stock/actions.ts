"use server";

import { isDomainError } from "@igs/kernel";
import {
  type ImportPlan,
  MAX_IMPORT_CHARS,
  adjustStock,
  importStock,
  previewStockImport,
  stockImportKey,
} from "@igs/module-inventory";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requestOrigin, requireStaffActor } from "../../server/actor";
import { ensureKernelConfigured } from "../../server/kernel";

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/** The upload panel: the dry run of a file, then its confirmation (igs-pharma#53). */
export interface StockImportState {
  readonly error?: string;
  readonly fileName?: string;
  /** The file's text, sent back with "Confirm" so exactly the previewed file is imported. */
  readonly csv?: string;
  readonly plan?: ImportPlan;
}

/** Step 1: read the uploaded file and show what it would change. Writes nothing. */
export async function previewImport(
  _previous: StockImportState,
  form: FormData,
): Promise<StockImportState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "inventory.file_missing" };
  if (file.size > MAX_IMPORT_CHARS) return { error: "inventory.file_too_large" };
  const csv = await file.text();
  try {
    const plan = await previewStockImport({ csv }, actor);
    return { fileName: file.name, csv, plan };
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { error: error.code };
  }
}

/**
 * Step 2: import the previewed file. The file's hash is the idempotency key, so a double click or a
 * second upload of the same file replays the first import instead of applying it twice.
 */
export async function confirmImport(
  previous: StockImportState,
  form: FormData,
): Promise<StockImportState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const csv = text(form, "csv");
  let changed: number;
  try {
    const result = await importStock({ csv }, actor, {
      idempotencyKey: stockImportKey(csv),
      origin: await requestOrigin(),
    });
    changed = result.changed;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { ...previous, error: error.code };
  }
  revalidatePath("/stock");
  redirect(`/stock?imported=${changed}`);
}

/** The Adjust dialog on a product's stock page. */
export interface AdjustState {
  readonly error?: string;
  readonly onHand?: number;
  readonly values?: Readonly<Record<string, string>>;
}

export async function adjust(_previous: AdjustState, form: FormData): Promise<AdjustState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const productId = text(form, "productId");
  const deltaText = text(form, "delta").trim();
  const values = {
    delta: deltaText,
    reason: text(form, "reason"),
    note: text(form, "note"),
  };
  try {
    await adjustStock(
      {
        productId,
        delta: /^[+-]?[0-9]+$/.test(deltaText) ? Number(deltaText) : Number.NaN,
        reason: values.reason,
        note: values.note,
      },
      actor,
      { origin: await requestOrigin() },
    );
  } catch (error) {
    if (!isDomainError(error)) throw error;
    const onHand = error.details?.["onHand"];
    return {
      error: error.code,
      values,
      ...(typeof onHand === "number" ? { onHand } : {}),
    };
  }
  revalidatePath("/stock");
  redirect(`/stock/${encodeURIComponent(productId)}?adjusted=1`);
}
