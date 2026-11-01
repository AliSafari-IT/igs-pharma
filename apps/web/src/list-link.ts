import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * "Order my list" (igs-pharma#218, milestone 5.4): the Android app's list, handed to the website cart
 * through a short-lived signed link. The app sends the CNKs of its list to
 * `POST /api/mobile/v1/list-link`, which answers with the link; the app opens it in the browser. The
 * token carries the product numbers and an expiry, signed with `AUTH_SECRET`: nothing is stored on the
 * server, and nothing personal is in it.
 *
 * Token: `v1.<cnk>-<cnk>-….<expiry seconds>.<HMAC-SHA256, base64url>`. Pure functions; the time is
 * passed in.
 */

/** How long a link opens the list: long enough to sign in first, short enough not to linger. */
export const LIST_LINK_TTL_S = 15 * 60;
/** The most products a link carries: the cart's line limit (`CART_MAX_LINES`). */
export const LIST_LINK_MAX = 30;
/** The URL parameter that carries the token. */
export const LIST_LINK_PARAM = "l";

const VERSION = "v1";
const CNK = /^[0-9]{7}$/;

function sign(secret: string, cnks: string, expires: number): Buffer {
  return createHmac("sha256", secret)
    .update(`igs-list-link/${VERSION}/${cnks}/${expires}`)
    .digest();
}

/**
 * The CNKs of a list as a link carries them: each 7 digits, in the list's order, each once, at most
 * {@link LIST_LINK_MAX}. `null` for anything else (the request is refused, never trimmed silently).
 */
export function listCnks(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > LIST_LINK_MAX) return null;
  if (!value.every((cnk): cnk is string => typeof cnk === "string" && CNK.test(cnk))) return null;
  return [...new Set(value)];
}

/** A new token for `cnks` (already checked with {@link listCnks}), valid {@link LIST_LINK_TTL_S}. */
export function createListToken(
  secret: string,
  cnks: readonly string[],
  now: number,
): { token: string; expiresAt: Date } {
  const expires = Math.floor(now / 1000) + LIST_LINK_TTL_S;
  const joined = cnks.join("-");
  const signature = sign(secret, joined, expires).toString("base64url");
  return {
    token: `${VERSION}.${joined}.${expires}.${signature}`,
    expiresAt: new Date(expires * 1000),
  };
}

/** What a token says once checked. */
export type ListTokenCheck =
  | { readonly ok: true; readonly cnks: readonly string[]; readonly expiresAt: Date }
  | { readonly ok: false; readonly reason: "invalid" | "expired" };

/**
 * Reads a token. `invalid` for anything this server did not sign (no secret, a forged, altered or
 * malformed token, an expiry further out than this server ever grants); `expired` for a genuine
 * token past its time.
 */
export function verifyListToken(
  secret: string | null,
  value: string | null | undefined,
  now: number,
): ListTokenCheck {
  const invalid = { ok: false, reason: "invalid" } as const;
  if (!secret || typeof value !== "string" || value.length > 600) return invalid;
  const parts = value.split(".");
  if (parts.length !== 4) return invalid;
  const [version, joined, expiresText, signature] = parts as [string, string, string, string];
  if (version !== VERSION || !/^[0-9]{1,12}$/.test(expiresText)) return invalid;
  const cnks = listCnks(joined.split("-"));
  if (!cnks || cnks.join("-") !== joined) return invalid;
  const expires = Number(expiresText);
  const seconds = Math.floor(now / 1000);
  if (expires > seconds + LIST_LINK_TTL_S) return invalid;
  const given = Buffer.from(signature, "base64url");
  const expected = sign(secret, joined, expires);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return invalid;
  if (expires <= seconds) return { ok: false, reason: "expired" };
  return { ok: true, cnks, expiresAt: new Date(expires * 1000) };
}
