import type { Db } from "@igs/db";
import { getDb } from "@igs/db/client";
import {
  type RolePermissionRow,
  rbacCatalogueLoaded,
  rbacDrift,
  setRbacCatalogue,
} from "@igs/rbac";
import { and, eq, isNull, or } from "drizzle-orm";

import { factorCount, mfaFactors, sessionMfaVerified } from "./mfa";
import { rolePermissions, userRoles, users } from "./schema";

/** Anything that can run a select (the pool, or a transaction in tests). */
type Reader = Pick<Db, "select">;

/**
 * Reads `identity.role_permissions` and checks it against the code catalogue (`@igs/rbac`). Fails
 * fast (readable error) when a migration is missing or the code moved on.
 */
export async function readRbacCatalogue(db: Reader): Promise<RolePermissionRow[]> {
  const rows = await db
    .select({
      roleKey: rolePermissions.roleKey,
      permissionKey: rolePermissions.permissionKey,
    })
    .from(rolePermissions);
  const { missing, extra } = rbacDrift(rows);
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `rbac.catalogue_drift: the database RBAC catalogue differs from the code (run the RBAC seed migration). missing=[${missing.join(", ")}] extra=[${extra.join(", ")}]`,
    );
  }
  return rows;
}

/**
 * Reads and checks the catalogue, then installs it for `hasPermission` (once per process: a
 * second call throws `rbac.catalogue_already_loaded`). Composition roots call `ensureRbacCatalogue`.
 */
export async function loadRbacCatalogue(db: Reader): Promise<void> {
  setRbacCatalogue(await readRbacCatalogue(db));
}

let loading: Promise<void> | undefined;

/**
 * Loads the catalogue once per process: concurrent callers share the load, later calls are free,
 * and a failed load is retried by the next caller. Called by every composition root at boot.
 */
export function ensureRbacCatalogue(db: Reader = getDb()): Promise<void> {
  if (rbacCatalogueLoaded()) return Promise.resolve();
  loading ??= loadRbacCatalogue(db).catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

export interface RoleGrant {
  readonly roleKey: string;
  /** `null` = every location. */
  readonly locationId: string | null;
}

/** The actor an edge adapter hands to the kernel, plus what the account page shows. */
export interface ResolvedActor {
  readonly type: "user";
  readonly id: string;
  /** Role keys effective at `locationId` (grants for that location plus all-location grants). */
  readonly roles: readonly string[];
  readonly kind: "customer" | "staff";
  readonly locationId: string | null;
  /**
   * 36b: the session proved a second factor AND the user still has one enrolled. Always `false`
   * when no `sessionId` was given. The kernel refuses staff without it (`kernel.mfa_required`).
   */
  readonly mfaVerified: boolean;
  readonly profile: {
    readonly name: string;
    readonly email: string;
    readonly locale: string;
    readonly status: "active";
    readonly grants: readonly RoleGrant[];
    /** The enrolled second factors, for the account and setup pages. */
    readonly factors: { readonly passkeys: number; readonly totp: boolean };
  };
}

/**
 * Builds the actor for `userId` from the database: one users row, its role grants and (36b) its
 * second-factor state for `sessionId`. Returns `null` for a missing, suspended or deleted user (the
 * edge treats that as unauthenticated, Q6). Never cached beyond the current request, so a revoked
 * role, a suspension or a removed factor applies on the very next request (Q2).
 */
export async function loadActor(
  db: Reader,
  userId: string,
  options: { locationId?: string | null; sessionId?: string | null } = {},
): Promise<ResolvedActor | null> {
  const locationId = options.locationId ?? null;
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      locale: users.locale,
      kind: users.kind,
      status: users.status,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!user || user.status !== "active") return null;

  const sessionId = options.sessionId ?? null;
  const [factors, sessionVerified] = await Promise.all([
    mfaFactors(db, userId),
    sessionId === null ? false : sessionMfaVerified(db, userId, sessionId),
  ]);

  const grants = await db
    .select({ roleKey: userRoles.roleKey, locationId: userRoles.locationId })
    .from(userRoles)
    .where(
      and(
        eq(userRoles.userId, userId),
        locationId === null
          ? isNull(userRoles.locationId)
          : or(isNull(userRoles.locationId), eq(userRoles.locationId, locationId)),
      ),
    )
    .orderBy(userRoles.roleKey);

  return {
    type: "user",
    id: user.id,
    roles: [...new Set(grants.map((g) => g.roleKey))],
    kind: user.kind,
    locationId,
    mfaVerified: sessionVerified && factorCount(factors) > 0,
    profile: {
      name: user.name,
      email: user.email,
      locale: user.locale,
      status: "active",
      grants,
      factors,
    },
  };
}

/** Whether Better Auth may create a session for `userId` (Q6: only `active` users). */
export async function sessionAllowed(db: Reader, userId: string): Promise<boolean> {
  const [user] = await db.select({ status: users.status }).from(users).where(eq(users.id, userId));
  return user?.status === "active";
}
