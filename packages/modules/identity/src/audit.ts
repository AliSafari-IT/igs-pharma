import { z } from "zod";

/** Audit actions recorded by the identity commands (`<domain>.<noun>.<verb>`). */
export const IDENTITY_AUDIT = {
  roleGranted: "identity.role.granted",
  roleRevoked: "identity.role.revoked",
  userSuspended: "identity.user.suspended",
  userReactivated: "identity.user.reactivated",
  userDeleted: "identity.user.deleted",
  mfaEnrolled: "identity.mfa.enrolled",
  mfaRemoved: "identity.mfa.removed",
  ownerBootstrapped: "identity.owner.bootstrapped",
  enrolmentReissued: "identity.enrolment.reissued",
  factorsReset: "identity.factors.reset",
  backupCodesRegenerated: "identity.mfa.backup_codes_regenerated",
  mailRequested: "identity.mail.requested",
} as const;

const roleChange = z.object({
  userId: z.uuid(),
  roleKey: z.string(),
  locationId: z.uuid().nullable(),
});
const userChange = z.object({ userId: z.uuid() });
const mfaChange = z.object({ userId: z.uuid(), method: z.enum(["passkey", "totp"]) });
const mailRequest = z.object({
  userId: z.uuid(),
  template: z.enum(["verify_email", "reset_password", "account_exists"]),
});
const bootstrapped = z.object({ userId: z.uuid(), roleKey: z.string() });

/** The signature of `registerAuditAction` from `@igs/module-audit`. */
export type RegisterAuditAction = (action: string, data: z.ZodObject<z.ZodRawShape>) => void;

/**
 * Registers the identity audit actions (identifiers only, D-028). Each composition root calls it
 * once, before `configureKernel`, passing `registerAuditAction` from `@igs/module-audit`:
 *
 *     registerAuditActions(registerAuditAction)
 *
 * The register function is injected so this module (which `@igs/auth` imports) never depends on
 * `@igs/module-audit`.
 */
export function registerAuditActions(register: RegisterAuditAction): void {
  register(IDENTITY_AUDIT.roleGranted, roleChange);
  register(IDENTITY_AUDIT.roleRevoked, roleChange);
  register(IDENTITY_AUDIT.userSuspended, userChange);
  register(IDENTITY_AUDIT.userReactivated, userChange);
  register(IDENTITY_AUDIT.userDeleted, userChange);
  register(IDENTITY_AUDIT.mfaEnrolled, mfaChange);
  register(IDENTITY_AUDIT.mfaRemoved, mfaChange);
  register(IDENTITY_AUDIT.ownerBootstrapped, bootstrapped);
  register(IDENTITY_AUDIT.enrolmentReissued, userChange);
  register(IDENTITY_AUDIT.factorsReset, userChange);
  register(IDENTITY_AUDIT.backupCodesRegenerated, userChange);
  register(IDENTITY_AUDIT.mailRequested, mailRequest);
}
