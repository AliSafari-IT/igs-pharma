"use server";

import { getFeatureFlags } from "@igs/config/feature-flags";
import { isDomainError } from "@igs/kernel";
import { placeOrder } from "@igs/module-orders";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  type AddressValues,
  type ContactValues,
  type PlaceFailure,
  type PlaceState,
  addressErrors,
  contactErrors,
  deliveryChoiceOf,
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
 * redirects to the order's page. Only the checkout id, the contact and, for home delivery
 * (igs-pharma#202), the address travel in the form: the lines, prices, owner and the delivery fee
 * are the server's. With home delivery switched off, the choice is pickup whatever was posted.
 */
export async function placeOrderAction(_previous: PlaceState, form: FormData): Promise<PlaceState> {
  const locale = cartLocale(text(form, "locale"));
  const checkoutId = uuidOf(form.get("checkoutId"));
  const values: ContactValues = {
    name: text(form, "name"),
    email: text(form, "email"),
    phone: text(form, "phone"),
  };
  const delivery = deliveryChoiceOf(form.get("delivery"), getFeatureFlags().homeDelivery);
  const address: AddressValues = {
    street: text(form, "street"),
    postalCode: text(form, "postalCode"),
    city: text(form, "city"),
  };
  const errors = contactErrors(values);
  const expectedText = form.get("expectedFee");
  const expectedFee =
    typeof expectedText === "string" && /^\d{1,9}$/.test(expectedText)
      ? Number(expectedText)
      : undefined;
  const problems = delivery === "delivery" ? addressErrors(address) : {};
  const shown = { delivery, address, addressErrors: problems };
  if (!checkoutId) return { values, errors, failure: "notFound", ...shown };
  if (Object.keys(errors).length > 0 || Object.keys(problems).length > 0) {
    return { values, errors, failure: null, ...shown };
  }

  const { actor, token } = await cartActor();
  let orderId: string | null = null;
  let statusToken: string | null = null;
  let failure: PlaceFailure = "failed";
  try {
    ({ orderId, statusToken } = await placeOrder(
      {
        cartToken: token,
        checkoutId,
        contact: values,
        delivery:
          delivery === "delivery"
            ? {
                method: "delivery",
                expectedFeeCents: expectedFee,
                address: {
                  street: address.street,
                  postalCode: address.postalCode,
                  city: address.city,
                },
              }
            : { method: "pickup" },
      },
      actor,
      { origin: await requestOrigin() },
    ));
  } catch (error) {
    if (!isDomainError(error)) throw error;
    failure = placeFailureOf(error.code);
    // the shopper must see the new fee before confirming again
    if (failure === "feeChanged") revalidatePath(`/${locale}/checkout/${checkoutId}`);
  }
  if (!orderId) return { values, errors: {}, failure, delivery, address, addressErrors: {} };
  // the status link: the order page, openable later without the cart cookie
  redirect(`/${locale}/orders/${orderId}${statusToken ? `?t=${statusToken}` : ""}`);
}
