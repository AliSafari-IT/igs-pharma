/**
 * The English text staff see for identity error codes (D-006: the kernel carries no text; the
 * back-office is English-only, so the mapping lives here). Staff-management Server Actions map a
 * thrown `DomainError.code` through `identityErrorMessage`.
 */
const ERRORS: Record<string, string> = {
  "identity.last_holder_protected":
    "This is the last active holder of the role. Give the role to someone else first, then try again.",
  "identity.pharmacist_access_requires_titular":
    "A pharmacist's access is managed by the pharmacist-titular, with the pharmacist actions.",
  "identity.not_a_pharmacist": "That account is not a pharmacist.",
  "identity.pharmacist_role_requires_titular":
    "Only the pharmacist-titular can grant or revoke a pharmacist role.",
  "identity.cannot_change_own_status": "You cannot change your own account status.",
  "identity.cannot_revoke_own_role": "You cannot revoke your own role.",
  "identity.invalid_status_transition": "That change is not possible for the account's status.",
  "identity.user_not_found": "That account was not found.",
  "identity.cannot_reset_own_sign_in":
    "You cannot reset your own sign-in. Ask another owner, or use the server's recovery command.",
  "identity.fresh_mfa_required": "Confirm it's you with your passkey first, then try again.",
  "identity.role_already_granted": "They already have that role.",
  "identity.role_not_granted": "They don't have that role.",
  "identity.role_kind_mismatch": "That role is not for a staff account.",
  "kernel.forbidden": "You are not allowed to do that.",
  "kernel.invalid_input": "That request was not valid. Reload the page and try again.",
};

export const identityErrorMessage = (code: string | undefined) =>
  (code && Object.hasOwn(ERRORS, code) && ERRORS[code]) || "That didn't work. Try again.";
