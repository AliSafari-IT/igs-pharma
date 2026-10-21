"use server";

import { isDomainError } from "@igs/kernel";
import {
  MAX_IMPORT_CHARS,
  adjustStock,
  applyReconciliation,
  assignUnknownLot,
  discardReconciliation,
  quarantineLot,
  receiveStock,
  releaseLot,
  releaseReservationByStaff,
  returnStock,
  setExpiryBuffer,
  startReconciliation,
  startReconciliationFromFile,
} from "@igs/module-inventory";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requestOrigin, requireStaffActor } from "../../server/actor";
import { ensureKernelConfigured } from "../../server/kernel";

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/** One problem line of a count file (`line` 0 is the file as a whole). */
export interface StockFileProblem {
  readonly line: number;
  readonly code: string;
}

/** The count upload (igs-pharma#166): problems in the file, or an error before reading it. */
export interface CountUploadState {
  readonly error?: string;
  readonly fileName?: string;
  /** Every problem in the file; nothing was stored. */
  readonly problems?: readonly StockFileProblem[];
}

const lineOf = (path: string): number => {
  const match = /^line\.([0-9]+)$/.exec(path);
  return match ? Number(match[1]) : 0;
};

/** Starts a count from an uploaded file and opens its preview. Moves no stock. */
export async function uploadCount(
  _previous: CountUploadState,
  form: FormData,
): Promise<CountUploadState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "inventory.file_missing" };
  if (file.size > MAX_IMPORT_CHARS) return { error: "inventory.file_too_large" };
  const csv = await file.text();
  let reconciliationId: string;
  try {
    ({ reconciliationId } = await startReconciliationFromFile({ csv }, actor, {
      origin: await requestOrigin(),
    }));
  } catch (error) {
    if (!isDomainError(error)) throw error;
    if (error.code === "inventory.reconciliation_invalid") {
      return {
        fileName: file.name,
        problems: (error.fields ?? []).map((f) => ({ line: lineOf(f.path), code: f.code })),
      };
    }
    return { error: error.code };
  }
  redirect(`/stock/counts/${reconciliationId}`);
}

/** Starts a count of one product's lots, typed in on its stock page, and opens its preview. */
export async function countLots(previous: LotActionState, form: FormData): Promise<LotActionState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const productId = text(form, "productId");
  const values: Record<string, string> = {};
  const lines: { lotId: string; counted: number }[] = [];
  for (const [name, value] of form.entries()) {
    if (!name.startsWith("count.") || typeof value !== "string") continue;
    values[name] = value;
    if (value.trim() === "") continue;
    const counted = /^[0-9]{1,7}$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
    if (!Number.isInteger(counted)) return { error: "inventory.quantity_invalid", values };
    lines.push({ lotId: name.slice("count.".length), counted });
  }
  if (lines.length === 0) return { error: "inventory.count_empty", values };
  let reconciliationId: string;
  try {
    ({ reconciliationId } = await startReconciliation({ productId, lines }, actor, {
      origin: await requestOrigin(),
    }));
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { ...previous, error: error.code, values };
  }
  redirect(`/stock/counts/${reconciliationId}`);
}

/** Applying or discarding a count from its preview page. */
export interface CountActionState {
  readonly error?: string;
}

export async function applyCount(
  _previous: CountActionState,
  form: FormData,
): Promise<CountActionState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const reconciliationId = text(form, "reconciliationId");
  try {
    await applyReconciliation({ reconciliationId }, actor, { origin: await requestOrigin() });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { error: error.code };
  }
  revalidatePath("/stock");
  redirect(`/stock/counts/${reconciliationId}?done=applied`);
}

export async function discardCount(
  _previous: CountActionState,
  form: FormData,
): Promise<CountActionState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const reconciliationId = text(form, "reconciliationId");
  try {
    await discardReconciliation({ reconciliationId }, actor, { origin: await requestOrigin() });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { error: error.code };
  }
  redirect(`/stock/counts/${reconciliationId}?done=discarded`);
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
