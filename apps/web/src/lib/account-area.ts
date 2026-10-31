/**
 * The signed-in account pages (igs-pharma#115 PR C, D-044), kept free of React and Next so they are
 * unit-tested. Server Actions answer with a redirect back to the page and a `?result=` key, so every
 * form works without JavaScript; the page turns the key into a message of the `account` namespace.
 */

/** The privacy policy version a customer's consent is recorded under, until the policy is versioned (1b). */
export const CONSENT_POLICY_VERSION = "2026-10";

export const ACCOUNT_RESULTS = [
  "profileSaved",
  "profileInvalid",
  "consentSaved",
  "requested",
  "alreadyOpen",
  "freshRequired",
  "failed",
] as const;
export type AccountResult = (typeof ACCOUNT_RESULTS)[number];

/** Results that are good news; the rest are shown as errors. */
const SUCCESS: readonly AccountResult[] = ["profileSaved", "consentSaved", "requested"];

export const isSuccessResult = (result: AccountResult): boolean => SUCCESS.includes(result);

/** The message key of a result (`resultProfileSaved`, …). */
export const resultMessageKey = (result: AccountResult): string =>
  `result${result.charAt(0).toUpperCase()}${result.slice(1)}`;

type Params = Readonly<Record<string, string | string[] | undefined>>;

/** `?result=` from the URL, or `null` for anything this page did not send. */
export function resultOf(params: Params): AccountResult | null {
  const value = params["result"];
  return typeof value === "string" && (ACCOUNT_RESULTS as readonly string[]).includes(value)
    ? (value as AccountResult)
    : null;
}

/**
 * Where to go after signing in again: only a path inside the account area (`/account` or
 * `/account/…`) or the early-access page (igs-pharma#199), never an address, a protocol-relative
 * `//host` or anything with a query or a dot, so the sign-in page can never be turned into an open
 * redirect.
 */
export function safeNext(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  return /^\/(?:account(?:\/[a-z-]+)*|early-access)$/.test(value) ? value : null;
}

/**
 * Whether the request carries a customer session cookie (`igs-c.session_token`, `__Secure-` prefixed
 * on https). Only for the header link: it says nothing about the session being valid, and every
 * account page checks the real session.
 */
export function hasCustomerSessionCookie(cookie: string | null): boolean {
  return /(?:^|;\s*)(?:__Secure-)?igs-c\.session_token=[^;]+/.test(cookie ?? "");
}
