import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { authEnv } from "@igs/config";

/**
 * The early-access pass (igs-pharma#199). While the storefront is closed (`SITE_GATE=coming-soon`), a
 * customer whose early-access grant is active gets this cookie from `/api/early-access/pass`, which
 * checks the grant in the database first (`issueEarlyAccessPass`). The proxy only reads it: like the
 * site gate it is a VISIBILITY switch, never authorization (every page and action still checks the
 * session and permissions).
 *
 * The cookie carries the user id and an expiry, signed with `AUTH_SECRET`, and the signature also
 * covers a hash of the customer's SESSION cookie: a pass copied to another browser, or kept after
 * signing out, matches no session and opens nothing. A pass lives `PASS_TTL_S` (15 minutes): that is
 * how long a revoked or expired grant can still show the shop. Past that, the proxy sends the browser
 * back to the pass route for a fresh database check (only a visitor who held a pass: nobody else is
 * ever redirected). Rotating `AUTH_SECRET` ends every pass.
 *
 * Pure functions on `node:crypto`; the time is passed in.
 */

export const PASS_COOKIE = "igs_early_access";
/** How long a pass opens the shop: the revocation window. */
export const PASS_TTL_S = 15 * 60;
/**
 * How long after its end an expired pass still sends the browser to the pass route for a re-check
 * (the cookie lives this long). After that the visitor just sees the coming-soon page again.
 */
export const PASS_REFRESH_WINDOW_S = 24 * 60 * 60;
/** Where a pass is issued and refreshed (`src/app/api/early-access/pass/route.ts`). */
export const PASS_PATH = "/api/early-access/pass";
/**
 * Set by the proxy on the request it forwards, only after a pass verified, so pages can show the
 * "early access" banner. The proxy deletes any value the client sent.
 */
export const EARLY_ACCESS_HEADER = "x-igs-early-access";
/**
 * Set by the proxy on the pages that stay reachable while the shop is closed (the early-access page and
 * the sign-in pages), for a visitor without a pass: they render a frame that shows nothing of the shop.
 * The proxy deletes any value the client sent.
 */
export const GATE_HEADER = "x-igs-gate";

/** The pass cookie: HttpOnly, Secure and SameSite=Lax, for this site only. */
export const PASS_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: PASS_TTL_S + PASS_REFRESH_WINDOW_S,
} as const;

/** The customer session cookie (`@igs/auth` customer instance), `__Secure-` prefixed over https. */
const SESSION_COOKIES = ["__Secure-igs-c.session_token", "igs-c.session_token"] as const;

/** The customer's session cookie value from a request's cookies, or `null`. */
export function sessionCookieValue(get: (name: string) => string | undefined): string | null {
  for (const name of SESSION_COOKIES) {
    const value = get(name);
    if (value) return value;
  }
  return null;
}

/**
 * The signing secret (`AUTH_SECRET`), or `null` when it is missing or too short: then no pass is ever
 * issued or accepted (fails closed, and never an error that would take the closed storefront down).
 */
export function passSecret(env: Readonly<Record<string, string | undefined>>): string | null {
  const parsed = authEnv.shape.AUTH_SECRET.safeParse(env["AUTH_SECRET"]);
  return parsed.success ? parsed.data : null;
}

const VERSION = "v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sign(secret: string, userId: string, expires: number, session: string): Buffer {
  const sessionHash = createHash("sha256").update(session).digest("base64url");
  return createHmac("sha256", secret)
    .update(`igs-early-access/${VERSION}/${userId}/${expires}/${sessionHash}`)
    .digest();
}

/**
 * A new pass for `userId`, bound to `session` (the session cookie value), ending at `until`
 * (milliseconds; the issuing command caps it at the grant's end) and never later than
 * `PASS_TTL_S` from `now`.
 */
export function createPass(
  secret: string,
  userId: string,
  session: string,
  now: number,
  until: number,
): string {
  const expires = Math.floor(Math.min(until, now + PASS_TTL_S * 1000) / 1000);
  return `${VERSION}.${userId}.${expires}.${sign(secret, userId, expires, session).toString("base64url")}`;
}

/** What a pass says, once its signature checked: `fresh` = it opens the shop now. */
export interface PassCheck {
  readonly userId: string;
  readonly fresh: boolean;
}

/**
 * Reads a pass. `null` for anything this server did not sign for THIS session: no secret, no session,
 * a forged, malformed or other person's pass, or one past its refresh window. A pass whose time is up
 * but still within the window comes back with `fresh: false` (the proxy then asks for a re-check).
 */
export function verifyPass(
  secret: string | null,
  value: string | undefined,
  session: string | null,
  now: number,
): PassCheck | null {
  if (!secret || !value || !session) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [version, userId, expiresText, signature] = parts as [string, string, string, string];
  if (version !== VERSION || !UUID.test(userId) || !/^[0-9]{1,12}$/.test(expiresText)) return null;
  const expires = Number(expiresText);
  const seconds = Math.floor(now / 1000);
  // claiming more life than this server ever grants, or past the refresh window
  if (expires > seconds + PASS_TTL_S || expires + PASS_REFRESH_WINDOW_S <= seconds) return null;
  const given = Buffer.from(signature, "base64url");
  const expected = sign(secret, userId, expires, session);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { userId, fresh: expires > seconds };
}

/**
 * Where to go after a pass was issued: a storefront page path (`/nl`, `/fr/p/123`), never an address,
 * a protocol-relative `//host`, a backslash trick or a query. Anything else is the home page.
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (typeof value !== "string" || value.length > 200) return "/";
  if (!/^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*\/?)?$/.test(value)) return "/";
  // no dot segments: what the browser resolves must be what was checked
  return value.split("/").some((segment) => segment === "." || segment === "..") ? "/" : value;
}

/**
 * A redirect with a RELATIVE `Location` (igs-pharma#199): never built from `request.url`, which
 * behind the edge carries the container's address (`0.0.0.0:3000`), not the public one. Browsers
 * resolve it against the address they asked for.
 */
export function relativeRedirect(path: string, status: 303 | 307 = 303): Response {
  return new Response(null, { status, headers: { location: path, "cache-control": "no-store" } });
}
