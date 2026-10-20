/**
 * The storefront cart (igs-pharma#116), kept free of React and Next so it is unit-tested. Server
 * Actions answer with a redirect to the cart page and a `?result=` key, so every form works without
 * JavaScript; the page turns the key into a message of the `cart` namespace.
 */

/**
 * The cart cookie: `__Host-` (Secure, path `/`, no Domain), HttpOnly, SameSite=Lax. Its value opens
 * a guest's cart; the server stores only its SHA-256. Kept as long as a cart lives without a change.
 */
export const CART_COOKIE = "__Host-igs-cart";
export const CART_COOKIE_MAX_AGE_SECONDS = 30 * 86_400;

export const cartCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: CART_COOKIE_MAX_AGE_SECONDS,
} as const;

/** A cookie value the cart accepts (128 bits, base64url); anything else is ignored. */
export const isCartToken = (value: string | undefined): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{22}$/.test(value);

export const CART_RESULTS = [
  "added",
  "updated",
  "removed",
  "limit",
  "full",
  "unavailable",
  "failed",
] as const;
export type CartResult = (typeof CART_RESULTS)[number];

const SUCCESS: readonly CartResult[] = ["added", "updated", "removed"];

export const isSuccessResult = (result: CartResult): boolean => SUCCESS.includes(result);

/** The message key of a result (`resultAdded`, …). */
export const resultMessageKey = (result: CartResult): string =>
  `result${result.charAt(0).toUpperCase()}${result.slice(1)}`;

/** `?result=` from the URL, or `null` for anything this page did not send. */
export function resultOf(params: Readonly<Record<string, string | string[] | undefined>>) {
  const value = params["result"];
  return typeof value === "string" && (CART_RESULTS as readonly string[]).includes(value)
    ? (value as CartResult)
    : null;
}

/** The result a refused cart command maps to (its error code). */
export function resultOfCode(code: string): CartResult {
  switch (code) {
    case "orders.cart_quantity_limit":
      return "limit";
    case "orders.cart_full":
      return "full";
    case "catalog.product_not_sellable":
      return "unavailable";
    default:
      return "failed";
  }
}

/** A quantity from a form: a whole number from 0 to 100, else `null`. */
export function quantityOf(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^[0-9]{1,3}$/.test(value)) return null;
  const n = Number(value);
  return n <= 100 ? n : null;
}

/** A product id from a form (a UUID), else `null`. */
export function productIdOf(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
    ? value
    : null;
}
