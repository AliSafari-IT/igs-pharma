import { z } from "zod";

import { MAIL_TEMPLATES } from "./schema";

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
  profileUpdated: "identity.profile.updated",
  earlyAccessRequested: "identity.early_access.requested",
  earlyAccessApproved: "identity.early_access.approved",
  earlyAccessRejected: "identity.early_access.rejected",
  earlyAccessRevoked: "identity.early_access.revoked",
  earlyAccessPassIssued: "identity.early_access.pass_issued",
  earlyAccessPassRefused: "identity.early_access.pass_refused",
  // igs-pharma#211
  earlyAccessInvited: "identity.early_access.invited",
  earlyAccessInvitationCancelled: "identity.early_access.invitation_cancelled",
  earlyAccessInvitationRedeemed: "identity.early_access.invitation_redeemed",
} as const;

const roleChange = z.object({
  userId: z.uuid(),
  roleKey: z.string(),
  locationId: z.uuid().nullable(),
});
const userChange = z.object({ userId: z.uuid() });
const mfaChange = z.object({ userId: z.uuid(), method: z.enum(["passkey", "totp"]) });
const mailRequest = z.object({
  // absent for an invitation (igs-pharma#211): it goes to an address, not a user
  userId: z.uuid().optional(),
  template: z.enum(MAIL_TEMPLATES),
});
const profileUpdated = z.object({
  userId: z.uuid(),
  nameChanged: z.boolean(),
  localeChanged: z.boolean(),
});
// early access (igs-pharma#199): identifiers and flags only, never the note or a reason (D-028)
const earlyAccessRequested = z.object({
  requestId: z.uuid(),
  userId: z.uuid(),
  updated: z.boolean(),
  hasNote: z.boolean(),
});
const earlyAccessApproved = z.object({
  requestId: z.uuid(),
  userId: z.uuid(),
  duration: z.enum(["7d", "30d", "90d", "until_launch"]),
  extended: z.boolean(),
});
const earlyAccessEnded = z.object({
  requestId: z.uuid(),
  userId: z.uuid(),
  hasReason: z.boolean(),
});
const earlyAccessPass = z.object({ userId: z.uuid() });
// igs-pharma#211: the invited address only as a hash, salted with the invitation id
const earlyAccessInvited = z.object({
  requestId: z.uuid(),
  addressHash: z.string().regex(/^[0-9a-f]{64}$/),
  duration: z.enum(["7d", "30d", "90d", "until_launch"]),
});
const earlyAccessInvitationCancelled = z.object({ requestId: z.uuid() });
const earlyAccessInvitationRedeemed = z.object({ requestId: z.uuid(), userId: z.uuid() });
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
  register(IDENTITY_AUDIT.profileUpdated, profileUpdated);
  register(IDENTITY_AUDIT.earlyAccessRequested, earlyAccessRequested);
  register(IDENTITY_AUDIT.earlyAccessApproved, earlyAccessApproved);
  register(IDENTITY_AUDIT.earlyAccessRejected, earlyAccessEnded);
  register(IDENTITY_AUDIT.earlyAccessRevoked, earlyAccessEnded);
  register(IDENTITY_AUDIT.earlyAccessPassIssued, earlyAccessPass);
  register(IDENTITY_AUDIT.earlyAccessPassRefused, earlyAccessPass);
  register(IDENTITY_AUDIT.earlyAccessInvited, earlyAccessInvited);
  register(IDENTITY_AUDIT.earlyAccessInvitationCancelled, earlyAccessInvitationCancelled);
  register(IDENTITY_AUDIT.earlyAccessInvitationRedeemed, earlyAccessInvitationRedeemed);
}
