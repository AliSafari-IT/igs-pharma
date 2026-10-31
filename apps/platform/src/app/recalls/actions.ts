"use server";

import { isDomainError } from "@igs/kernel";
import { endRecall, startRecall } from "@igs/module-inventory";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requestOrigin, requireStaffActor } from "../../server/actor";
import { ensureKernelConfigured } from "../../server/kernel";
import type { LotActionState } from "../stock/actions";

/** Recalls (igs-pharma#187): start one from a product's stock page, end it from the recall's page. */

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

const valuesOf = (form: FormData) =>
  Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));

/** Starts a recall on the product: every lot, or the lots ticked. */
export async function startRecallAction(
  _previous: LotActionState,
  form: FormData,
): Promise<LotActionState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const lotIds = form.getAll("lotId").filter((v): v is string => typeof v === "string");
  const everyLot = text(form, "scope") !== "lots";
  if (!everyLot && lotIds.length === 0) {
    return { error: "inventory.recall_lots_missing", values: valuesOf(form) };
  }
  let recallId: string;
  try {
    ({ recallId } = await startRecall(
      {
        productId: text(form, "productId"),
        ...(everyLot ? {} : { lotIds }),
        source: text(form, "source"),
        note: text(form, "note"),
      },
      actor,
      { origin: await requestOrigin() },
    ));
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { error: error.code, values: valuesOf(form) };
  }
  revalidatePath("/stock");
  revalidatePath("/recalls");
  redirect(`/recalls/${encodeURIComponent(recallId)}?done=started`);
}

/** Ends a recall: the product may sell again; its lots stay in quarantine. */
export async function endRecallAction(
  _previous: LotActionState,
  form: FormData,
): Promise<LotActionState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const recallId = text(form, "recallId");
  try {
    await endRecall({ recallId }, actor, { origin: await requestOrigin() });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { error: error.code, values: valuesOf(form) };
  }
  revalidatePath("/stock");
  revalidatePath("/recalls");
  redirect(`/recalls/${encodeURIComponent(recallId)}?done=ended`);
}
