/**
 * Better Auth and igs-mfa error codes → the text staff see (D-006: codes carry no text; the
 * platform is English-only, so the mapping lives here).
 */
const MESSAGES: Record<string, string> = {
  MFA_REQUIRED: "Confirm it's you with your passkey or authenticator app first.",
  FRESH_PASSKEY_REQUIRED:
    "Check your passkey again first: adding a sign-in method needs a passkey check in the last 10 minutes.",
  LAST_FACTOR: "You can't remove your only 2-step login method. Add another one first.",
  LAST_PASSKEY:
    "You can't remove your only passkey: you sign in with it. Add another passkey first.",
  PASSKEY_FIRST: "Add a passkey first. An authenticator app can only be added as an extra.",
  PASSKEY_NOT_FOUND: "That passkey was not found. Reload the page and try again.",
  INVALID_PASSWORD: "That password is not right.",
  AUDIT_FAILED: "That change could not be recorded, so it was not saved. Try again in a minute.",
  INVALID_CODE: "That code is not right. Check the time on your phone and try again.",
  USER_VERIFICATION_REQUIRED:
    "Your device didn't confirm it's you (PIN, fingerprint or face). Try again.",
  ENROLMENT_LINK_INVALID: "This link is invalid, used or expired. Ask the owner for a new one.",
  TOO_MANY_REQUESTS: "Too many attempts. Wait a minute and try again.",
  STAFF_ONLY: "This is the staff back-office. Sign in with your staff passkey.",
};

const FALLBACK = "That didn't work. Try again.";

export function authErrorMessage(
  error: { code?: string | undefined; status?: number | undefined } | null | undefined,
): string {
  const byCode = error?.code ? MESSAGES[error.code] : undefined;
  if (byCode) return byCode;
  if (error?.status === 429) return MESSAGES["TOO_MANY_REQUESTS"] ?? FALLBACK;
  return FALLBACK;
}

type WithError = { readonly error?: unknown; readonly data?: unknown } | null | undefined;

const errorCodeOf = (result: WithError) =>
  typeof result?.error === "object" && result.error !== null && "code" in result.error
    ? (result.error as { code?: unknown }).code
    : undefined;

/**
 * Adding a sign-in method needs a passkey check from the last 10 minutes (igs-pharma#100). When the
 * server answers `FRESH_PASSKEY_REQUIRED`, ask the person for the passkey (`check`, one touch or
 * face scan) and try the action once more. A failed check ends the attempt with its own error.
 */
export async function withFreshPasskey<T extends WithError>(
  action: () => Promise<T>,
  check: () => Promise<WithError>,
): Promise<T> {
  const first = await action();
  if (errorCodeOf(first) !== "FRESH_PASSKEY_REQUIRED") return first;
  const checked = await check();
  if (checked?.error) return checked as T; // an error-shaped answer: callers only read `.error`
  return action();
}
