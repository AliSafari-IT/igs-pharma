/**
 * The early-access page (igs-pharma#199), kept free of React and Next so it is unit-tested. The
 * request form answers with a redirect back to the page and a `?result=` key (works without
 * JavaScript); the pass route does the same when it cannot open the shop.
 */

export const EARLY_ACCESS_RESULTS = [
  "requested",
  "updated",
  "tooSoon",
  "alreadyGranted",
  "notVerified",
  "rateLimited",
  "passRefused",
  "failed",
] as const;
export type EarlyAccessResult = (typeof EARLY_ACCESS_RESULTS)[number];

const SUCCESS: readonly EarlyAccessResult[] = ["requested", "updated"];

export const isEarlyAccessSuccess = (result: EarlyAccessResult): boolean =>
  SUCCESS.includes(result);

/** The message key of a result in the `earlyAccess` namespace (`resultRequested`, …). */
export const earlyAccessResultKey = (result: EarlyAccessResult): string =>
  `result${result.charAt(0).toUpperCase()}${result.slice(1)}`;

/** `?result=` from the URL, or `null` for anything this page did not send. */
export function earlyAccessResultOf(
  params: Readonly<Record<string, string | string[] | undefined>>,
): EarlyAccessResult | null {
  const value = params["result"];
  return typeof value === "string" && (EARLY_ACCESS_RESULTS as readonly string[]).includes(value)
    ? (value as EarlyAccessResult)
    : null;
}

/** The result of a refused request, from the domain error code. */
export function earlyAccessResultFromCode(code: string): EarlyAccessResult {
  switch (code) {
    case "identity.early_access.too_soon":
      return "tooSoon";
    case "identity.early_access.already_granted":
      return "alreadyGranted";
    case "identity.email_not_verified":
      return "notVerified";
    default:
      return "failed";
  }
}

/**
 * Rate limits (per account and per address), counted in `identity.rate_limits`: asking (a new request
 * mails staff) and the pass check (every 15 minutes while shopping, plus clicks).
 */
export const EARLY_ACCESS_LIMITS = {
  requestPerUser: { windowSeconds: 60 * 60, max: 5 },
  requestPerIp: { windowSeconds: 60 * 60, max: 20 },
  passPerUser: { windowSeconds: 15 * 60, max: 20 },
  passPerIp: { windowSeconds: 15 * 60, max: 60 },
} as const;
