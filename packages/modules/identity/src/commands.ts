import { type Ctx, command, conflict, forbidden, notFound } from "@igs/kernel";
import { PERMISSIONS, PHARMACIST_ROLES, ROLES, ROLE_KEYS, type RoleKey } from "@igs/rbac";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { IDENTITY_AUDIT } from "./audit";
import { sessions, userRoles, users } from "./schema";

/**
 * Identity commands (T-016, 36a). Every one runs through the kernel: authorize → validate → one
 * transaction (handler + audit). Audit data carries identifiers and status only (D-028).
 *
 * Who may grant what (Q7, D-030): `staff.manage` (the owner) grants and revokes every role EXCEPT
 * `pharmacist` and `pharmacist_titular`; those need `pharmacy.pharmacists.manage`, which only the
 * titular pharmacist holds. So the owner cannot make anyone a pharmacist, and the titular cannot
 * hand out administrative roles. Hence two command pairs with one static permission each.
 */

const roleGrantInput = z.object({
  userId: z.uuid(),
  roleKey: z.enum(ROLE_KEYS as [RoleKey, ...RoleKey[]]),
  /** `null` (default) = every location; Phase 1 has one pharmacy (Q3). */
  locationId: z.uuid().nullable().default(null),
});

type RoleGrantInput = z.infer<typeof roleGrantInput>;

const userInput = z.object({ userId: z.uuid() });

const isPharmacistRole = (roleKey: RoleKey) => PHARMACIST_ROLES.includes(roleKey);

/** The target user, or `NotFound` for an unknown or deleted one. */
async function targetUser(ctx: Ctx, userId: string) {
  const [user] = await ctx.tx
    .select({ id: users.id, kind: users.kind, status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .for("update");
  if (!user || user.status === "deleted") throw notFound("identity.user_not_found");
  return user;
}

async function grant(ctx: Ctx, input: RoleGrantInput): Promise<void> {
  const user = await targetUser(ctx, input.userId);
  // staff roles hold only .any permissions, the customer role only .own ones: never cross over
  if (ROLES[input.roleKey].kind !== user.kind) {
    throw conflict("identity.role_kind_mismatch", { roleKey: input.roleKey });
  }
  const inserted = await ctx.tx
    .insert(userRoles)
    .values({
      userId: input.userId,
      roleKey: input.roleKey,
      locationId: input.locationId,
      grantedBy: ctx.actor.type === "user" ? ctx.actor.id : null,
      grantedAt: ctx.now,
    })
    .onConflictDoNothing({ target: [userRoles.userId, userRoles.roleKey, userRoles.locationId] })
    .returning({ id: userRoles.id });
  if (inserted.length === 0) throw conflict("identity.role_already_granted");
  await ctx.audit.record({
    action: IDENTITY_AUDIT.roleGranted,
    entityType: "user",
    entityId: input.userId,
    data: { userId: input.userId, roleKey: input.roleKey, locationId: input.locationId },
  });
}

async function revoke(ctx: Ctx, input: RoleGrantInput): Promise<void> {
  // the last owner or titular revoking their own role would leave nobody able to grant it back
  if (ctx.actor.type === "user" && ctx.actor.id === input.userId) {
    throw forbidden("identity.cannot_revoke_own_role");
  }
  await targetUser(ctx, input.userId);
  const removed = await ctx.tx
    .delete(userRoles)
    .where(
      and(
        eq(userRoles.userId, input.userId),
        eq(userRoles.roleKey, input.roleKey),
        input.locationId === null
          ? isNull(userRoles.locationId)
          : eq(userRoles.locationId, input.locationId),
      ),
    )
    .returning({ id: userRoles.id });
  if (removed.length === 0) throw notFound("identity.role_not_granted");
  await ctx.audit.record({
    action: IDENTITY_AUDIT.roleRevoked,
    entityType: "user",
    entityId: input.userId,
    data: { userId: input.userId, roleKey: input.roleKey, locationId: input.locationId },
  });
}

function requireNonPharmacistRole(roleKey: RoleKey): void {
  if (isPharmacistRole(roleKey)) throw forbidden("identity.pharmacist_role_requires_titular");
}

function requirePharmacistRole(roleKey: RoleKey): void {
  if (!isPharmacistRole(roleKey)) throw forbidden("identity.not_a_pharmacist_role");
}

/** Grants a non-pharmacist role (`staff.manage`). */
export const grantRole = command({
  name: "identity.role.grant",
  input: roleGrantInput,
  permission: PERMISSIONS.staff.manage,
  async handler({ input, ctx }) {
    requireNonPharmacistRole(input.roleKey);
    await grant(ctx, input);
  },
});

/** Revokes a non-pharmacist role (`staff.manage`). The change applies on the next request (Q2). */
export const revokeRole = command({
  name: "identity.role.revoke",
  input: roleGrantInput,
  permission: PERMISSIONS.staff.manage,
  async handler({ input, ctx }) {
    requireNonPharmacistRole(input.roleKey);
    await revoke(ctx, input);
  },
});

/** Grants `pharmacist` or `pharmacist_titular` (`pharmacy.pharmacists.manage`, Q7). */
export const grantPharmacistRole = command({
  name: "identity.pharmacist_role.grant",
  input: roleGrantInput,
  permission: PERMISSIONS.pharmacy.pharmacistsManage,
  async handler({ input, ctx }) {
    requirePharmacistRole(input.roleKey);
    await grant(ctx, input);
  },
});

/** Revokes `pharmacist` or `pharmacist_titular` (`pharmacy.pharmacists.manage`, Q7). */
export const revokePharmacistRole = command({
  name: "identity.pharmacist_role.revoke",
  input: roleGrantInput,
  permission: PERMISSIONS.pharmacy.pharmacistsManage,
  async handler({ input, ctx }) {
    requirePharmacistRole(input.roleKey);
    await revoke(ctx, input);
  },
});

type UserStatus = "active" | "suspended" | "deleted";

/**
 * Moves a user to `to` and, when that ends access, deletes ALL their sessions in the same
 * transaction (Q6): together with `resolveActor` returning no actor for a non-active user and the
 * session-create hook refusing new sessions, access stops on the very next request.
 */
async function setStatus(
  ctx: Ctx,
  userId: string,
  from: readonly UserStatus[],
  to: UserStatus,
  action: string,
): Promise<void> {
  if (ctx.actor.type === "user" && ctx.actor.id === userId) {
    throw forbidden("identity.cannot_change_own_status");
  }
  const user = await targetUser(ctx, userId);
  if (!from.includes(user.status)) throw conflict("identity.invalid_status_transition");
  await ctx.tx.update(users).set({ status: to, updatedAt: ctx.now }).where(eq(users.id, userId));
  if (to !== "active") await ctx.tx.delete(sessions).where(eq(sessions.userId, userId));
  await ctx.audit.record({ action, entityType: "user", entityId: userId, data: { userId } });
}

/** Suspends an active user and ends their sessions (`staff.manage`). */
export const suspendUser = command({
  name: "identity.user.suspend",
  input: userInput,
  permission: PERMISSIONS.staff.manage,
  async handler({ input, ctx }) {
    await setStatus(ctx, input.userId, ["active"], "suspended", IDENTITY_AUDIT.userSuspended);
  },
});

/** Reactivates a suspended user (`staff.manage`). A deleted user stays deleted. */
export const reactivateUser = command({
  name: "identity.user.reactivate",
  input: userInput,
  permission: PERMISSIONS.staff.manage,
  async handler({ input, ctx }) {
    await setStatus(ctx, input.userId, ["suspended"], "active", IDENTITY_AUDIT.userReactivated);
  },
});

/**
 * Marks a user deleted and ends their sessions (`staff.manage`). The row stays (audit history,
 * foreign keys); erasure of personal data is a separate, later flow (GDPR).
 */
export const deleteUser = command({
  name: "identity.user.delete",
  input: userInput,
  permission: PERMISSIONS.staff.manage,
  async handler({ input, ctx }) {
    await setStatus(
      ctx,
      input.userId,
      ["active", "suspended"],
      "deleted",
      IDENTITY_AUDIT.userDeleted,
    );
  },
});
