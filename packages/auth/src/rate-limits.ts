/**
 * Where both Better Auth instances read the client's address, for their per-client rate limits.
 * The edge (Caddy in `asafarim-platform`) sets `X-Forwarded-For` to ONE address on every IGS site,
 * the storefront and the back-office alike. Better Auth trusts a single-value header only: a chain
 * (a client-supplied prefix, an unexpected extra hop) resolves to no address and shares one bucket
 * per path (fails closed: slower for everyone, never a bypass by spoofing). Without this setting
 * the default is the same header; naming it keeps the dependency on the edge visible.
 */
export const CLIENT_IP_FROM_EDGE: { ipAddressHeaders: string[] } = {
  ipAddressHeaders: ["x-forwarded-for"],
};

/**
 * Per-IP limits on the STAFF instance's unauthenticated and second-factor endpoints. The
 * back-office is reachable from any network (no IP allowlist at the edge), so these, with the
 * staff-only session rules and the 2-step login, are what stand between it and a guessing client.
 * They win over Better Auth's built-in and plugin rules (its `customRules` are checked last).
 * Counted in memory, per process: enough for the single platform container; a second instance
 * would need shared storage (`storage: "database"`, as the customer instance uses).
 */
export const STAFF_RATE_LIMIT_RULES = {
  // every sign-in method of the instance: e-mail + password (on, though staff have no password),
  // and any `/sign-in/*` a plugin might add later
  "/sign-in/*": { window: 60, max: 5 },
  // passkey sign-in: the challenge (a database row per call) and its verification
  "/passkey/generate-authenticate-options": { window: 60, max: 10 },
  "/passkey/verify-authentication": { window: 60, max: 10 },
  // the bootstrap enrolment link (single use; e2e session-limits.spec.ts relies on 5 a minute)
  "/enrolment/redeem": { window: 60, max: 5 },
  // second factors. Better Auth counts TOTP failures only on the sign-in path; these also cap
  // "verify on an existing session" (36b). The OTP pair is not configured here; capped anyway.
  "/two-factor/verify-totp": { window: 60, max: 5 },
  "/two-factor/verify-backup-code": { window: 60, max: 5 },
  "/two-factor/verify-otp": { window: 60, max: 5 },
  "/two-factor/send-otp": { window: 60, max: 3 },
} as const satisfies Record<string, { window: number; max: number }>;
