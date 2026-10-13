import { type Ctx, command, conflict, forbidden, notFound } from "@igs/kernel";
import { PERMISSIONS, PHARMACIST_ROLES, ROLES, ROLE_KEYS, type RoleKey } from "@igs/rbac";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { IDENTITY_AUDIT } from "./audit";
import {
  ENROLMENT_TTL_MS,
  deleteEnrolmentTokens,
  factorCount,
  mfaFactors,
  newEnrolmentToken,
  storeEnrolmentToken,
} from "./mfa";
import { sessions, userRoles, users } from "./schema";

/**
 * Identity commands (T-016, 36a). Every one runs through the kernel: authorize → validate → one
 * transaction (handler + audit). Audit data carries identifiers and status only (D-028).
 *
 * Who may grant what (Q7, D-030): `staff.manage` (the owner) grants and revokes every role EXCEPT
 * `pharmacist` and `pharmacist_titular`; those need `pharmacy.pharmacists.manage`, which only the
 * titular pharmacist holds. So the owner cannot make anyone a pharmacist, and the titular cannot
 * hand out administrative roles. Hence two command pairs with one static permission each.
 *
 * D-035: that rule covers every action that ends or restores a pharmacist's access, not only role
 * revocation. Same pattern, one static permission per command family: `suspendUser` & co.
 * (`staff.manage`) refuse a target holding a pharmacist role, for everyone; `suspendPharmacist` & co.
 * (`pharmacy.pharmacists.manage`) handle only such targets. The last active `owner` /
 * `pharmacist_titular` can never be removed, by either family.
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

/**
 * Roles that must always keep at least one ACTIVE holder (D-035): with nobody left, nobody could
 * grant them back (owner: `staff.manage`; titular: `pharmacy.pharmacists.manage`). Fixed order: the
 * advisory locks below are always taken in this order, so two removals cannot deadlock.
 */
const PROTECTED_ROLES = ["owner", "pharmacist_titular"] as const satisfies readonly RoleKey[];
type ProtectedRole = (typeof PROTECTED_ROLES)[number];
const isProtectedRole = (roleKey: RoleKey): roleKey is ProtectedRole =>
  (PROTECTED_ROLES as readonly RoleKey[]).includes(roleKey);

/**
 * Serialises every removal of a holder of `roleKeys` for the rest of the transaction. Without it two
 * concurrent removals (A suspends B while B suspends A) each count the other as the remaining holder
 * under READ COMMITTED, both pass, and nobody is left. Taken BEFORE any row lock or count.
 */
async function lockHolders(ctx: Ctx, roleKeys: readonly ProtectedRole[]): Promise<void> {
  for (const roleKey of PROTECTED_ROLES) {
    if (!roleKeys.includes(roleKey)) continue;
    await ctx.tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`identity.holders.${roleKey}`}))`,
    );
  }
}

/** How many ACTIVE users hold `roleKey` (any location scope). */
async function activeHolders(ctx: Ctx, roleKey: ProtectedRole): Promise<number> {
  const [row] = await ctx.tx
    .select({ n: sql<number>`count(distinct ${userRoles.userId})::int` })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(userRoles.roleKey, roleKey), eq(users.status, "active")));
  return row?.n ?? 0;
}

type HolderCounts = Readonly<Record<ProtectedRole, number>>;

async function countHolders(ctx: Ctx, roleKeys: readonly ProtectedRole[]): Promise<HolderCounts> {
  const counts = { owner: 0, pharmacist_titular: 0 };
  for (const roleKey of roleKeys) counts[roleKey] = await activeHolders(ctx, roleKey);
  return counts;
}

/**
 * Run after a removal, inside the lock: throws (rolling the transaction back) when a protected role
 * went from having an active holder to having none. A role that already had none (a seat emptied
 * before this guard existed) does not block the removal, so recovery is never made harder.
 */
async function assertHoldersRemain(
  ctx: Ctx,
  before: HolderCounts,
  roleKeys: readonly ProtectedRole[],
): Promise<void> {
  for (const roleKey of roleKeys) {
    if (before[roleKey] > 0 && (await activeHolders(ctx, roleKey)) === 0) {
      throw conflict("identity.last_holder_protected", { roleKey });
    }
  }
}

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
  const guarded: readonly ProtectedRole[] = isProtectedRole(input.roleKey) ? [input.roleKey] : [];
  await lockHolders(ctx, guarded);
  await targetUser(ctx, input.userId);
  const before = await countHolders(ctx, guarded);
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
  await assertHoldersRemain(ctx, before, guarded);
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
  family: "staff" | "pharmacist",
): Promise<void> {
  if (ctx.actor.type === "user" && ctx.actor.id === userId) {
    throw forbidden("identity.cannot_change_own_status");
  }
  // ending access can remove the last owner/titular: serialise against every other removal first
  const ends = to !== "active";
  if (ends) await lockHolders(ctx, PROTECTED_ROLES);
  const user = await targetUser(ctx, userId);
  // D-035: the target's roles decide which command family may act (a data-dependent check inside
  // the handler; each family's static permission was already checked by the kernel, D-005)
  const held = await ctx.tx
    .select({ roleKey: userRoles.roleKey })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));
  const isPharmacist = held.some((row) => PHARMACIST_ROLES.includes(row.roleKey as RoleKey));
  if (family === "staff" && isPharmacist) {
    throw forbidden("identity.pharmacist_access_requires_titular");
  }
  if (family === "pharmacist" && !isPharmacist) throw conflict("identity.not_a_pharmacist");
  if (!from.includes(user.status)) throw conflict("identity.invalid_status_transition");
  const before = ends ? await countHolders(ctx, PROTECTED_ROLES) : null;
  await ctx.tx.update(users).set({ status: to, updatedAt: ctx.now }).where(eq(users.id, userId));
  if (before) await assertHoldersRemain(ctx, before, PROTECTED_ROLES);
  if (ends) await ctx.tx.delete(sessions).where(eq(sessions.userId, userId));
  await ctx.audit.record({ action, entityType: "user", entityId: userId, data: { userId } });
}

/** Suspends an active user and ends their sessions (`staff.manage`). Not for a pharmacist. */
export const suspendUser = command({
  name: "identity.user.suspend",
  input: userInput,
  permission: PERMISSIONS.staff.manage,
  async handler({ input, ctx }) {
    await setStatus(
      ctx,
      input.userId,
      ["active"],
      "suspended",
      IDENTITY_AUDIT.userSuspended,
      "staff",
    );
  },
});

/** Reactivates a suspended user (`staff.manage`). A deleted user stays deleted. Not for a pharmacist. */
export const reactivateUser = command({
  name: "identity.user.reactivate",
  input: userInput,
  permission: PERMISSIONS.staff.manage,
  async handler({ input, ctx }) {
    await setStatus(
      ctx,
      input.userId,
      ["suspended"],
      "active",
      IDENTITY_AUDIT.userReactivated,
      "staff",
    );
  },
});

/**
 * Marks a user deleted and ends their sessions (`staff.manage`). The row stays (audit history,
 * foreign keys); erasure of personal data is a separate, later flow (GDPR). Not for a pharmacist.
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
      "staff",
    );
  },
});

/** Suspends an active pharmacist or titular (`pharmacy.pharmacists.manage`, D-035). Same audit event. */
export const suspendPharmacist = command({
  name: "identity.pharmacist.suspend",
  input: userInput,
  permission: PERMISSIONS.pharmacy.pharmacistsManage,
  async handler({ input, ctx }) {
    await setStatus(
      ctx,
      input.userId,
      ["active"],
      "suspended",
      IDENTITY_AUDIT.userSuspended,
      "pharmacist",
    );
  },
});

/** Reactivates a suspended pharmacist or titular (`pharmacy.pharmacists.manage`, D-035). */
export const reactivatePharmacist = command({
  name: "identity.pharmacist.reactivate",
  input: userInput,
  permission: PERMISSIONS.pharmacy.pharmacistsManage,
  async handler({ input, ctx }) {
    await setStatus(
      ctx,
      input.userId,
      ["suspended"],
      "active",
      IDENTITY_AUDIT.userReactivated,
      "pharmacist",
    );
  },
});

/** Marks a pharmacist or titular deleted (`pharmacy.pharmacists.manage`, D-035). */
export const deletePharmacist = command({
  name: "identity.pharmacist.delete",
  input: userInput,
  permission: PERMISSIONS.pharmacy.pharmacistsManage,
  async handler({ input, ctx }) {
    await setStatus(
      ctx,
      input.userId,
      ["active", "suspended"],
      "deleted",
      IDENTITY_AUDIT.userDeleted,
      "pharmacist",
    );
  },
});

// ── 36b: 2-step login ───────────────────────────────────────────────────────────────────────────

/** Roles the bootstrap CLI may create a first holder for (Q4). */
const BOOTSTRAP_ROLES = ["owner", "pharmacist_titular"] as const satisfies readonly RoleKey[];

const bootstrapInput = z.object({
  email: z.email().max(254),
  name: z.string().trim().min(1).max(200),
  roleKey: z.enum(BOOTSTRAP_ROLES).default("owner"),
});

const bootstrapOutput = z.object({
  userId: z.uuid(),
  /** Shown once by the CLI, inside the link; only its SHA-256 is stored. */
  token: z.string(),
  expiresAt: z.date(),
});

/**
 * Creates the first `owner` (or, with `roleKey: "pharmacist_titular"`, the first titular
 * pharmacist) as a staff user with **no credential**, and a single-use enrolment token valid for
 * 15 minutes (Q4). Refuses while the role has an ACTIVE holder, so it cannot mint a second owner; a deleted or
 * suspended holder does not block the seat (D-035).
 * Run by the bootstrap CLI as a system actor holding `system_bootstrap`; no user can hold that role.
 */
export const bootstrapStaff = command({
  name: "identity.owner.bootstrap",
  input: bootstrapInput,
  output: bootstrapOutput,
  permission: PERMISSIONS.identity.bootstrap,
  async handler({ input, ctx }) {
    // two concurrent runs must not both see "no holder yet"
    await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('identity.owner.bootstrap'))`);
    // only ACTIVE holders block the seat: a deleted or suspended one must not (D-035)
    const [holder] = await ctx.tx
      .select({ id: userRoles.id })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(eq(userRoles.roleKey, input.roleKey), eq(users.status, "active")))
      .limit(1);
    if (holder) throw conflict("identity.role_already_held", { roleKey: input.roleKey });
    const [taken] = await ctx.tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email));
    if (taken) throw conflict("identity.email_taken");

    const [user] = await ctx.tx
      .insert(users)
      .values({ name: input.name, email: input.email, kind: "staff" })
      .returning({ id: users.id });
    if (!user) throw new Error("identity.owner.bootstrap: user insert returned no row");
    await ctx.tx
      .insert(userRoles)
      .values({ userId: user.id, roleKey: input.roleKey, locationId: null, grantedAt: ctx.now });

    const token = newEnrolmentToken();
    const expiresAt = new Date(ctx.now.getTime() + ENROLMENT_TTL_MS);
    await storeEnrolmentToken(ctx.tx, user.id, token, expiresAt);
    await ctx.audit.record({
      action: IDENTITY_AUDIT.ownerBootstrapped,
      entityType: "user",
      entityId: user.id,
      data: { userId: user.id, roleKey: input.roleKey },
    });
    return { userId: user.id, token, expiresAt };
  },
});

/**
 * Issues a NEW enrolment link for a bootstrap holder who never enrolled (Q4 recovery): the first
 * link expired or was lost. Only for an `active` staff user who holds `owner` or
 * `pharmacist_titular` and has **zero** second factors, so it can never take over an account that
 * is in use. Earlier unused links of that user are deleted, and so are the sessions earlier links
 * started (they could still enrol the first factor); audited as
 * `identity.enrolment.reissued`. Same actor and permission as `bootstrapStaff`.
 */
export const reissueEnrolment = command({
  name: "identity.enrolment.reissue",
  input: z.object({ email: z.email().max(254) }),
  output: bootstrapOutput,
  permission: PERMISSIONS.identity.bootstrap,
  async handler({ input, ctx }) {
    await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('identity.owner.bootstrap'))`);
    const [user] = await ctx.tx
      .select({ id: users.id, kind: users.kind, status: users.status })
      .from(users)
      .where(eq(users.email, input.email))
      .for("update");
    if (!user || user.status !== "active" || user.kind !== "staff") {
      throw notFound("identity.user_not_found");
    }
    const [holds] = await ctx.tx
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(and(eq(userRoles.userId, user.id), inArray(userRoles.roleKey, [...BOOTSTRAP_ROLES])))
      .limit(1);
    if (!holds) throw conflict("identity.not_a_bootstrap_holder");
    if (factorCount(await mfaFactors(ctx.tx, user.id)) > 0) {
      throw conflict("identity.already_enrolled");
    }

    await deleteEnrolmentTokens(ctx.tx, user.id);
    // a session an earlier link already started keeps the first-factor exception (`enrolment_at`):
    // end them all. With zero factors none is MFA-verified, so nothing legitimate is lost.
    await ctx.tx.delete(sessions).where(eq(sessions.userId, user.id));
    const token = newEnrolmentToken();
    const expiresAt = new Date(ctx.now.getTime() + ENROLMENT_TTL_MS);
    await storeEnrolmentToken(ctx.tx, user.id, token, expiresAt);
    await ctx.audit.record({
      action: IDENTITY_AUDIT.enrolmentReissued,
      entityType: "user",
      entityId: user.id,
      data: { userId: user.id },
    });
    return { userId: user.id, token, expiresAt };
  },
});

/** Sign-in factor changes Better Auth reports through `@igs/auth`'s `onSecurityEvent` (36b). */
export const SECURITY_EVENTS = ["mfa.enrolled", "mfa.removed"] as const;
export type SecurityEventType = (typeof SECURITY_EVENTS)[number];

/**
 * Audits a sign-in factor change (`identity.mfa.enrolled|removed {userId, method}`). Run by each
 * app's composition root from `configureAuth({ onSecurityEvent })` as a system actor holding
 * `system_auth`, so `@igs/auth` never depends on `@igs/module-audit` (dependency inversion).
 */
export const recordSecurityEvent = command({
  name: "identity.security_event.record",
  input: z.object({
    userId: z.uuid(),
    type: z.enum(SECURITY_EVENTS),
    method: z.enum(["passkey", "totp"]),
  }),
  permission: PERMISSIONS.identity.securityEventsRecord,
  async handler({ input, ctx }) {
    await ctx.audit.record({
      action:
        input.type === "mfa.enrolled" ? IDENTITY_AUDIT.mfaEnrolled : IDENTITY_AUDIT.mfaRemoved,
      entityType: "user",
      entityId: input.userId,
      data: { userId: input.userId, method: input.method },
    });
  },
});
