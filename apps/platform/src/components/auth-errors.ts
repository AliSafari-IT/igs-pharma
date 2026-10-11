/**
 * Better Auth and igs-mfa error codes → the text staff see (D-006: codes carry no text; the
 * platform is English-only, so the mapping lives here).
 */
const MESSAGES: Record<string, string> = {
  MFA_REQUIRED: "Confirm it's you with your passkey or authenticator app first.",
  LAST_FACTOR: "You can't remove your only 2-step login method. Add another one first.",
  INVALID_CODE: "That code is not right. Check the time on your phone and try again.",
  USER_VERIFICATION_REQUIRED:
    "Your device didn't confirm it's you (PIN, fingerprint or face). Try again.",
  ENROLMENT_LINK_INVALID: "This link is invalid, used or expired. Ask the owner for a new one.",
  TOO_MANY_REQUESTS: "Too many attempts. Wait a minute and try again.",
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
