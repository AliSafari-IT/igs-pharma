"use server";

import { isDomainError } from "@igs/kernel";
import { parseEuroAmount, setDeliverySettings } from "@igs/module-orders";
import { revalidatePath } from "next/cache";

import { requestOrigin, requireStaffActor } from "../../../server/actor";
import { ensureKernelConfigured } from "../../../server/kernel";

/** The delivery settings form (igs-pharma#202). */
export interface DeliverySettingsState {
  readonly error?: string;
  readonly done?: boolean;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * Saves the delivery price and the free-delivery value, typed as euros. An empty free-delivery field
 * means delivery is never free. The change needs the owner's or the titular's passkey check from the
 * last 10 minutes (`identity.fresh_mfa_required`: the form asks for the passkey and submits the SAME
 * form again); the form's `submissionId` is the kernel's idempotency key, so a retry or a double
 * submit saves once. The command refuses everyone without `orders.delivery_settings.manage`.
 */
export async function saveDeliverySettings(
  _previous: DeliverySettingsState,
  form: FormData,
): Promise<DeliverySettingsState> {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const priceCents = parseEuroAmount(text(form, "price"));
  if (priceCents === null) return { error: "orders.delivery_price_invalid" };
  const freeFromText = text(form, "freeFrom").trim();
  const freeFromCents = freeFromText === "" ? null : parseEuroAmount(freeFromText);
  if (freeFromText !== "" && freeFromCents === null) {
    return { error: "orders.delivery_free_from_invalid" };
  }
  try {
    await setDeliverySettings({ priceCents, freeFromCents }, actor, {
      origin: await requestOrigin(),
      idempotencyKey: text(form, "submissionId"),
    });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { error: error.code };
  }
  revalidatePath("/settings/delivery");
  return { done: true };
}
