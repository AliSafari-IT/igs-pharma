import { z } from "zod";

/** Audit actions recorded by the identity commands (`<domain>.<noun>.<verb>`). */
export const IDENTITY_AUDIT = {
  roleGranted: "identity.role.granted",
  roleRevoked: "identity.role.revoked",
  userSuspended: "identity.user.suspended",
  userReactivated: "identity.user.reactivated",
  userDeleted: "identity.user.deleted",
} as const;

const roleChange = z.object({
  userId: z.uuid(),
  roleKey: z.string(),
  locationId: z.uuid().nullable(),
});
const userChange = z.object({ userId: z.uuid() });

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
}
