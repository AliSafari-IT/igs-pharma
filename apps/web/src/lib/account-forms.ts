/**
 * The rules behind the customer account forms (igs-pharma#115, D-044), kept free of React so they
 * are unit-tested. Every function returns a message KEY in the `account` namespace, never text.
 *
 * Privacy (D-044, no account enumeration): what a form shows never depends on whether an account
 * exists. Sign-up and the reset request end on the same "check your inbox" answer for any address;
 * a failed sign-in is one message whatever the reason (unknown address, wrong password, a staff
 * address, a suspended account).
 */

/** Better Auth's own upper bound on the customer instance (`maxPasswordLength`). */
export const PASSWORD_MAX = 128;
export const NAME_MAX = 100;
export const EMAIL_MAX = 254;

export type FieldErrorKey =
  | "nameRequired"
  | "nameTooLong"
  | "emailRequired"
  | "emailInvalid"
  | "passwordRequired"
  | "passwordTooShort"
  | "passwordTooLong";

/** Something that looks like an address; the server has the final word (INVALID_EMAIL). */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function nameError(value: string): FieldErrorKey | null {
  const name = value.trim();
  if (name === "") return "nameRequired";
  if (name.length > NAME_MAX) return "nameTooLong";
  return null;
}

export function emailError(value: string): FieldErrorKey | null {
  const email = value.trim();
  if (email === "") return "emailRequired";
  if (email.length > EMAIL_MAX || !EMAIL_SHAPE.test(email)) return "emailInvalid";
  return null;
}

/**
 * Length is the only rule (D-044: no composition rules). Counted like the server counts it
 * (`string.length`), so the browser never accepts what Better Auth refuses.
 */
export function passwordError(value: string, min: number): FieldErrorKey | null {
  if (value === "") return "passwordRequired";
  if (value.length < min) return "passwordTooShort";
  if (value.length > PASSWORD_MAX) return "passwordTooLong";
  return null;
}

/** The `error` of a Better Auth client call, as far as these forms read it. */
export type AuthFailure =
  | { readonly code?: string | undefined; readonly status?: number | undefined }
  | null
  | undefined;

export type SignInFailureKey = "signInFailed" | "signInNotVerified" | "tooManyAttempts";

/**
 * A failed sign-in. `EMAIL_NOT_VERIFIED` is only answered after a correct password, so it tells the
 * owner nothing new and helps them on (the server sends a fresh link). Every other failure is the
 * same message, so the answer never says whether the address has an account.
 */
export function signInFailure(error: AuthFailure): SignInFailureKey {
  if (error?.status === 429) return "tooManyAttempts";
  if (error?.code === "EMAIL_NOT_VERIFIED") return "signInNotVerified";
  return "signInFailed";
}

export type FormField = "name" | "email" | "password";

/**
 * A refused sign-up that belongs to one field (the server checks what the browser checked, so this
 * is rare), or `null`. None of these depends on whether the address has an account.
 */
export function signUpFieldFailure(
  error: AuthFailure,
): { readonly field: FormField; readonly key: FieldErrorKey } | null {
  switch (error?.code) {
    case "PASSWORD_TOO_SHORT":
      return { field: "password", key: "passwordTooShort" };
    case "PASSWORD_TOO_LONG":
      return { field: "password", key: "passwordTooLong" };
    case "INVALID_EMAIL":
      return { field: "email", key: "emailInvalid" };
    default:
      return null;
  }
}

export type RequestFailureKey = "tooManyAttempts" | "requestFailed";

/** Sign-up or reset request that the server did not take: too many tries, or try again. */
export function requestFailure(error: AuthFailure): RequestFailureKey {
  return error?.status === 429 ? "tooManyAttempts" : "requestFailed";
}

export type ResetFailureKey =
  | "resetLinkInvalid"
  | "passwordTooShort"
  | "passwordTooLong"
  | "tooManyAttempts"
  | "requestFailed";

/** Setting the new password failed: a used or expired link, a length the server refused, or else. */
export function resetFailure(error: AuthFailure): ResetFailureKey {
  if (error?.status === 429) return "tooManyAttempts";
  switch (error?.code) {
    case "INVALID_TOKEN":
      return "resetLinkInvalid";
    case "PASSWORD_TOO_SHORT":
      return "passwordTooShort";
    case "PASSWORD_TOO_LONG":
      return "passwordTooLong";
    default:
      return "requestFailed";
  }
}

export type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

const single = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

/** Better Auth's tokens are URL-safe; anything else in `token` is not a link it made. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{8,256}$/;

/**
 * The reset link lands on the reset page with `?token=…` (or `?error=INVALID_TOKEN` when Better Auth
 * already knows the link is bad). Returns the token, or `null` when the page should say the link is
 * invalid and offer a new one.
 */
export function resetToken(params: SearchParams): string | null {
  if (params["error"] !== undefined) return null;
  const token = single(params["token"]);
  return token && TOKEN_SHAPE.test(token) ? token : null;
}

/** The marker the sign-up's `callbackURL` carries, so only Better Auth's success lands as "confirmed". */
export const VERIFIED_MARKER = "ok";

export type VerifyOutcome = "confirmed" | "invalid" | "pending";

/**
 * Where the e-mail confirmation link lands. Better Auth redirects to the sign-up's `callbackURL`
 * (`?status=ok`) on success and adds `error=…` on failure (an expired or used link). A visit with
 * neither is someone who has not clicked the link yet.
 */
export function verifyOutcome(params: SearchParams): VerifyOutcome {
  const status = params["status"];
  if (params["error"] !== undefined) return "invalid";
  if (status === undefined) return "pending";
  return status === VERIFIED_MARKER ? "confirmed" : "invalid";
}
