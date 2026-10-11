import type { Db } from "@igs/db";
import { identitySchema } from "@igs/module-identity";
import { and, eq, isNull, or } from "drizzle-orm";

import {
  type RolePermissionRow,
  codeRolePermissions,
  rbacCatalogueLoaded,
  setRbacCatalogue,
} from "./permissions";

const { rolePermissions, userRoles, users } = identitySchema;

/** Anything that can run a select (the pool, or a transaction in tests). */
type Reader = Pick<Db, "select">;

const pair = (row: RolePermissionRow) => `${row.roleKey}:${row.permissionKey}`;

/** Pairs present in code but not in the DB (`missing`) and the reverse (`extra`). */
export function rbacDrift(dbRows: readonly RolePermissionRow[]): {
  missing: string[];
  extra: string[];
} {
  const inDb = new Set(dbRows.map(pair));
  const inCode = new Set(codeRolePermissions().map(pair));
  return {
    missing: [...inCode].filter((p) => !inDb.has(p)).sort(),
    extra: [...inDb].filter((p) => !inCode.has(p)).sort(),
  };
}

/**
 * Reads `identity.role_permissions`, checks it against the code catalogue and installs it for
 * `hasPermission`. Fails fast (readable error) when a migration is missing or the code moved on.
 */
export async function loadRbacCatalogue(db: Reader): Promise<void> {
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
  setRbacCatalogue(rows);
}

let loading: Promise<void> | undefined;

/** Loads the catalogue once per process (concurrent callers share the load; a failure retries). */
export function ensureRbacCatalogue(db: Reader): Promise<void> {
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
  readonly profile: {
    readonly name: string;
    readonly email: string;
    readonly locale: string;
    readonly status: "active";
    readonly grants: readonly RoleGrant[];
  };
}

/**
 * Builds the actor for `userId` from the database: one users row and its role grants. Returns
 * `null` for a missing, suspended or deleted user (the edge treats that as unauthenticated, Q6).
 * Never cached beyond the current request, so a revoked role or a suspension applies on the
 * very next request (Q2).
 */
export async function loadActor(
  db: Reader,
  userId: string,
  options: { locationId?: string | null } = {},
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
    profile: {
      name: user.name,
      email: user.email,
      locale: user.locale,
      status: "active",
      grants,
    },
  };
}

/** Whether Better Auth may create a session for `userId` (Q6: only `active` users). */
export async function sessionAllowed(db: Reader, userId: string): Promise<boolean> {
  const [user] = await db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, userId));
  return user?.status === "active";
}
