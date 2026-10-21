"use server";

import { isDomainError } from "@igs/kernel";
import { advanceOrder, decideReview, requestRefund } from "@igs/module-orders";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requestOrigin, requireStaffActor } from "../../server/actor";
import { ensureKernelConfigured } from "../../server/kernel";

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

const versionOf = (form: FormData) => {
  const value = text(form, "expectedVersion");
  return /^[0-9]+$/.test(value) ? Number(value) : Number.NaN;
};

export interface OrderActionState {
  readonly error?: string;
}

/** The pharmacist's decision on an order in review. */
export async function decide(
  _previous: OrderActionState,
  form: FormData,
): Promise<OrderActionState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const orderId = text(form, "orderId");
  const note = text(form, "note").trim();
  try {
    await decideReview(
      {
        orderId,
        decision: text(form, "decision"),
        ...(note ? { note } : {}),
        expectedVersion: versionOf(form),
      },
      actor,
      { origin: await requestOrigin() },
    );
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { error: error.code };
  }
  revalidatePath("/orders");
  redirect(`/orders/${encodeURIComponent(orderId)}?done=review`);
}

/** The next fulfilment step. */
export async function advance(
  _previous: OrderActionState,
  form: FormData,
): Promise<OrderActionState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const orderId = text(form, "orderId");
  try {
    await advanceOrder({ orderId, to: text(form, "to"), expectedVersion: versionOf(form) }, actor, {
      origin: await requestOrigin(),
    });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { error: error.code };
  }
  revalidatePath("/orders");
  redirect(`/orders/${encodeURIComponent(orderId)}?done=step`);
}

/** Asks for the refund of a closed, paid order; the worker executes it at Mollie. */
export async function refund(
  _previous: OrderActionState,
  form: FormData,
): Promise<OrderActionState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const orderId = text(form, "orderId");
  const note = text(form, "note").trim();
  try {
    await requestRefund(
      { orderId, reason: text(form, "reason"), ...(note ? { note } : {}) },
      actor,
      { origin: await requestOrigin() },
    );
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { error: error.code };
  }
  revalidatePath("/orders");
  redirect(`/orders/${encodeURIComponent(orderId)}?done=refund`);
}
