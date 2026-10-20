"use server";

import { isDomainError } from "@igs/kernel";
import { getCart, newCartToken, setCartLine, startCheckout } from "@igs/module-orders";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  CART_COOKIE,
  type CartResult,
  cartCookieOptions,
  productIdOf,
  quantityOf,
  resultOfCode,
} from "../../../lib/cart-area";
import { cartActor, cartLocale } from "../../../server/cart";
import { requestOrigin } from "../../../server/customer";

/**
 * The cart's Server Actions (igs-pharma#116). Each answers with a redirect to the cart page and a
 * `?result=` key, so the forms work without JavaScript. Only a product id and a quantity travel in a
 * form: the price, the limits and whose cart it is are decided on the server.
 */

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/** `redirect` throws, so it is always called OUTSIDE a try block. */
function back(locale: string, result: CartResult): never {
  redirect(`/${locale}/cart?result=${result}`);
}

/** "Add to cart" on a product page: one more of it, up to the per-order limit. */
export async function addToCart(form: FormData): Promise<void> {
  const locale = cartLocale(text(form, "locale"));
  const productId = productIdOf(form.get("productId"));
  if (!productId) back(locale, "failed");

  let { actor, token } = await cartActor();
  // a guest's first add mints the cookie; a customer's cart needs none
  if (actor.type === "anonymous" && !token) {
    token = newCartToken();
    (await cookies()).set(CART_COOKIE, token, cartCookieOptions);
  }
  let result: CartResult = "added";
  try {
    const cart = await getCart({ cartToken: token, locale }, actor);
    const current = cart.lines.find((line) => line.productId === productId)?.quantity ?? 0;
    await setCartLine({ cartToken: token, productId, quantity: current + 1 }, actor, {
      origin: await requestOrigin(),
    });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    result = resultOfCode(error.code);
  }
  back(locale, result);
}

/** The quantity field of a cart line; 0 (or "Remove") takes the line out. */
export async function updateCartLine(form: FormData): Promise<void> {
  const locale = cartLocale(text(form, "locale"));
  const productId = productIdOf(form.get("productId"));
  const quantity = text(form, "remove") === "1" ? 0 : quantityOf(form.get("quantity"));
  if (!productId || quantity === null) back(locale, "failed");

  const { actor, token } = await cartActor();
  // a guest without a cookie has no cart: nothing to change
  if (actor.type === "anonymous" && !token) back(locale, "failed");
  let result: CartResult = quantity === 0 ? "removed" : "updated";
  try {
    await setCartLine({ cartToken: token, productId, quantity }, actor, {
      origin: await requestOrigin(),
    });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    result = resultOfCode(error.code);
  }
  back(locale, result);
}

/**
 * "Checkout" on the cart (and "Start again" on a lapsed checkout): re-prices the cart and holds its
 * stock, then opens the checkout page. A refusal (short, no longer sellable, empty) comes back to
 * the cart with its `?result=`.
 */
export async function startCheckoutAction(form: FormData): Promise<void> {
  const locale = cartLocale(text(form, "locale"));
  const { actor, token } = await cartActor();
  if (actor.type === "anonymous" && !token) back(locale, "empty");
  let checkoutId: string | null = null;
  let result: CartResult = "failed";
  try {
    ({ checkoutId } = await startCheckout({ cartToken: token, locale }, actor, {
      origin: await requestOrigin(),
    }));
  } catch (error) {
    if (!isDomainError(error)) throw error;
    result = resultOfCode(error.code);
  }
  if (!checkoutId) back(locale, result);
  redirect(`/${locale}/checkout/${checkoutId}`);
}
