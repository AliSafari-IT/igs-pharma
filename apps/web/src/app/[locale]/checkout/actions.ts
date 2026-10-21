"use server";

import { isDomainError } from "@igs/kernel";
import { placeOrder } from "@igs/module-orders";
import { redirect } from "next/navigation";

import {
  type ContactValues,
  type PlaceFailure,
  type PlaceState,
  contactErrors,
  placeFailureOf,
  uuidOf,
} from "../../../lib/checkout-area";
import { cartActor, cartLocale } from "../../../server/cart";
import { requestOrigin } from "../../../server/customer";

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * "Place order" on the checkout page (igs-pharma#116): the contact for the pickup, then
 * `orders.order.place`. Answers the form (useActionState) with the values and per-field errors, or
 * redirects to the order's page. Only the checkout id and the contact travel in the form: the
 * lines, prices and owner are the server's.
 */
export async function placeOrderAction(_previous: PlaceState, form: FormData): Promise<PlaceState> {
  const locale = cartLocale(text(form, "locale"));
  const checkoutId = uuidOf(form.get("checkoutId"));
  const values: ContactValues = {
    name: text(form, "name"),
    email: text(form, "email"),
    phone: text(form, "phone"),
  };
  const errors = contactErrors(values);
  if (!checkoutId) return { values, errors, failure: "notFound" };
  if (Object.keys(errors).length > 0) return { values, errors, failure: null };

  const { actor, token } = await cartActor();
  let orderId: string | null = null;
  let statusToken: string | null = null;
  let failure: PlaceFailure = "failed";
  try {
    ({ orderId, statusToken } = await placeOrder(
      { cartToken: token, checkoutId, contact: values },
      actor,
      { origin: await requestOrigin() },
    ));
  } catch (error) {
    if (!isDomainError(error)) throw error;
    failure = placeFailureOf(error.code);
  }
  if (!orderId) return { values, errors: {}, failure };
  // the status link: the order page, openable later without the cart cookie
  redirect(`/${locale}/orders/${orderId}${statusToken ? `?t=${statusToken}` : ""}`);
}
