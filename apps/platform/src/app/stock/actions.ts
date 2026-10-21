"use server";

import { isDomainError } from "@igs/kernel";
import {
  MAX_IMPORT_CHARS,
  adjustStock,
  assignUnknownLot,
  importStock,
  prepareStockImport,
  quarantineLot,
  receiveStock,
  releaseLot,
  releaseReservationByStaff,
  returnStock,
  setExpiryBuffer,
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

/** One problem line of a stock file (`line` 0 is the file as a whole). */
export interface StockFileProblem {
  readonly line: number;
  readonly code: string;
}

/** The upload panel: the preview of a file (a stored plan), then its confirmation (igs-pharma#53, #83). */
export interface StockImportState {
  readonly error?: string;
  readonly fileName?: string;
  /** The stored plan the confirm step applies: a fresh one for every preview. */
  readonly planId?: string;
  readonly rows?: readonly PreparedRow[];
  /** Every problem in the file; when present nothing was stored and nothing can be confirmed. */
  readonly problems?: readonly StockFileProblem[];
}

export type PreparedRow = Awaited<ReturnType<typeof prepareStockImport>>["rows"][number];

const lineOf = (path: string): number => {
  const match = /^line\.([0-9]+)$/.exec(path);
  return match ? Number(match[1]) : 0;
};

/** Step 1: read the uploaded file and store what it would change as a plan. Writes no stock. */
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
    const { planId, rows } = await prepareStockImport({ csv }, actor, {
      origin: await requestOrigin(),
    });
    return { fileName: file.name, planId, rows };
  } catch (error) {
    if (!isDomainError(error)) throw error;
    if (error.code === "inventory.import_invalid") {
      return {
        fileName: file.name,
        problems: (error.fields ?? []).map((f) => ({ line: lineOf(f.path), code: f.code })),
      };
    }
    return { error: error.code };
  }
}

/**
 * Step 2: apply the previewed plan. Only the plan's id is sent: the server applies what the preview
 * showed, or refuses when stock moved since. The plan id is the idempotency key, so a double click
 * replays the first result, while the same file previewed again is a new plan.
 */
export async function confirmImport(
  previous: StockImportState,
  form: FormData,
): Promise<StockImportState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const planId = text(form, "planId");
  let changed: number;
  try {
    const result = await importStock({ planId }, actor, {
      idempotencyKey: stockImportKey(planId),
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
    lotId: text(form, "lotId"),
    delta: deltaText,
    reason: text(form, "reason"),
    note: text(form, "note"),
  };
  try {
    await adjustStock(
      {
        productId,
        ...(values.lotId ? { lotId: values.lotId } : {}),
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

/** The Release dialog on a reservation (igs-pharma#99). */
export interface ReleaseState {
  readonly error?: string;
}

/**
 * Staff gives a reservation's stock back, with a reason (`inventory.stock.manage`). Only an ACTIVE
 * reservation can be released; the page then shows the stock as available again.
 */
export async function release(_previous: ReleaseState, form: FormData): Promise<ReleaseState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const productId = text(form, "productId");
  try {
    await releaseReservationByStaff(
      { reservationId: text(form, "reservationId"), reason: text(form, "reason") },
      actor,
      { origin: await requestOrigin() },
    );
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { error: error.code };
  }
  revalidatePath("/stock");
  redirect(`/stock/${encodeURIComponent(productId)}?released=1`);
}

// ── lots (igs-pharma#164) ────────────────────────────────────────────────────────────────────────

/** A lot dialog or button on a product's stock page. */
export interface LotActionState {
  readonly error?: string;
  readonly values?: Readonly<Record<string, string>>;
}

const wholeNumber = (value: string) => (/^[0-9]+$/.test(value.trim()) ? Number(value) : Number.NaN);
const optional = (value: string) => (value.trim() ? value.trim() : undefined);

/** Runs a lot command; on success back to the product's page with `done`, else the refusal. */
async function lotAction(
  form: FormData,
  done: string,
  run: (
    actor: Awaited<ReturnType<typeof requireStaffActor>>,
    origin: Awaited<ReturnType<typeof requestOrigin>>,
  ) => Promise<unknown>,
): Promise<LotActionState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const productId = text(form, "productId");
  try {
    await run(actor, await requestOrigin());
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return {
      error: error.code,
      values: Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])),
    };
  }
  revalidatePath("/stock");
  redirect(`/stock/${encodeURIComponent(productId)}?done=${done}`);
}

/** Receive stock from the pharmacy into the web pool, into its lot. */
export async function receive(_previous: LotActionState, form: FormData): Promise<LotActionState> {
  return lotAction(form, "received", (actor, origin) => {
    const lotNumber = optional(text(form, "lotNumber"));
    const expiryDate = optional(text(form, "expiryDate"));
    const note = optional(text(form, "note"));
    return receiveStock(
      {
        productId: text(form, "productId"),
        quantity: wholeNumber(text(form, "quantity")),
        ...(lotNumber ? { lotNumber } : {}),
        ...(expiryDate ? { expiryDate } : {}),
        ...(note ? { note } : {}),
      },
      actor,
      { origin },
    );
  });
}

/** Give stock of one lot back to the pharmacy. */
export async function returnLot(
  _previous: LotActionState,
  form: FormData,
): Promise<LotActionState> {
  return lotAction(form, "returned", (actor, origin) => {
    const note = optional(text(form, "note"));
    return returnStock(
      {
        lotId: text(form, "lotId"),
        quantity: wholeNumber(text(form, "quantity")),
        ...(note ? { note } : {}),
      },
      actor,
      { origin },
    );
  });
}

/** Record the lot of stock from before lots. */
export async function assignLot(
  _previous: LotActionState,
  form: FormData,
): Promise<LotActionState> {
  return lotAction(form, "assigned", (actor, origin) => {
    const expiryDate = optional(text(form, "expiryDate"));
    return assignUnknownLot(
      {
        productId: text(form, "productId"),
        quantity: wholeNumber(text(form, "quantity")),
        lotNumber: text(form, "lotNumber").trim(),
        ...(expiryDate ? { expiryDate } : {}),
      },
      actor,
      { origin },
    );
  });
}

/** Take a lot out of sale (pharmacist). */
export async function quarantine(
  _previous: LotActionState,
  form: FormData,
): Promise<LotActionState> {
  return lotAction(form, "quarantined", (actor, origin) =>
    quarantineLot({ lotId: text(form, "lotId"), reason: text(form, "reason") }, actor, { origin }),
  );
}

/** Put a quarantined lot back on sale (pharmacist). */
export async function releaseFromQuarantine(
  _previous: LotActionState,
  form: FormData,
): Promise<LotActionState> {
  return lotAction(form, "released_lot", (actor, origin) =>
    releaseLot({ lotId: text(form, "lotId") }, actor, { origin }),
  );
}

/** The expiry buffer (titular), from the stock list. */
export async function expiryBuffer(
  _previous: LotActionState,
  form: FormData,
): Promise<LotActionState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  try {
    await setExpiryBuffer({ days: wholeNumber(text(form, "days")) }, actor, {
      origin: await requestOrigin(),
    });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { error: error.code, values: { days: text(form, "days") } };
  }
  revalidatePath("/stock");
  redirect("/stock?buffer=1");
}
