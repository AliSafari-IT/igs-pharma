/**
 * RBAC catalogue (B-02, T-016). **Code is canonical**: the roles, permissions and role → permission
 * map below are seeded into `identity.roles|permissions|role_permissions` by a migration generated
 * from this file (`tools/db/gen-rbac-seed.mjs`), and a real-Postgres drift test fails when the two
 * disagree. At boot each process loads the mapping from the database (`loadRbacCatalogue()` in
 * `@igs/auth`), which installs it here with `setRbacCatalogue()`; `hasPermission` stays synchronous.
 *
 * Callers (the kernel) depend only on `hasPermission(roles, permission)` (T-005a contract). Roles are
 * always resolved server-side from the session/DB by the edge adapter, never from client input (D-005).
 *
 * This file has no imports on purpose: the seed generator runs it with plain Node (type stripping).
 */

export const PERMISSIONS = {
  orders: {
    /** Staff-wide access to orders. Customers hold `readOwn` instead. */
    read: "orders.read",
    /** Customer access to their OWN orders: handlers check it with `ctx.authorizeResource`. */
    readOwn: "orders.read.own",
    create: "orders.create",
    reviewDecide: "orders.review.decide",
  },
  catalog: {
    read: "catalog.read",
    manage: "catalog.manage",
  },
  staff: {
    invite: "staff.invite",
    /** Grant/revoke non-pharmacist roles; suspend, reactivate and delete users. */
    manage: "staff.manage",
  },
  pharmacy: {
    /** Grant/revoke `pharmacist` and `pharmacist_titular` (Q7): only the titular holds it (D-030). */
    pharmacistsManage: "pharmacy.pharmacists.manage",
  },
} as const;

/** Values of every group, distributed over the union (indexing a union by `keyof` yields `never`). */
type GroupValues<G> = G extends unknown ? G[keyof G] : never;

export type Permission = GroupValues<(typeof PERMISSIONS)[keyof typeof PERMISSIONS]>;

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS).flatMap((group) =>
  Object.values(group),
);

export type RoleKind = "customer" | "staff";

export interface RoleDefinition {
  readonly kind: RoleKind;
  readonly description: string;
}

/** Every role. Staff roles hold only `.any` permissions; customer roles only `.own` ones (T-016). */
export const ROLES = {
  owner: { kind: "staff", description: "Pharmacy owner: runs the business, manages staff" },
  pharmacist_titular: {
    kind: "staff",
    description: "Titular pharmacist: legally responsible, manages pharmacists",
  },
  pharmacist: { kind: "staff", description: "Pharmacist: decides on pharmaceutical reviews" },
  pharmacy_assistant: { kind: "staff", description: "Pharmacy assistant" },
  customer_service: { kind: "staff", description: "Customer service" },
  content_editor: { kind: "staff", description: "Catalogue content editor" },
  customer: { kind: "customer", description: "Webshop customer" },
} as const satisfies Record<string, RoleDefinition>;

export type RoleKey = keyof typeof ROLES;

export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];

/**
 * Pharmacist-only permissions (REQ-PHC-01/05): never implied by `owner` or any administrative
 * role. A person who is both owner and pharmacist simply holds both roles (D-030).
 */
export const PHARMACIST_ONLY: readonly Permission[] = [
  PERMISSIONS.orders.reviewDecide,
  PERMISSIONS.pharmacy.pharmacistsManage,
];

/** Roles that only a holder of `pharmacy.pharmacists.manage` may grant or revoke (Q7). */
export const PHARMACIST_ROLES: readonly RoleKey[] = ["pharmacist", "pharmacist_titular"];

const isOwnScoped = (permission: string) => permission.endsWith(".own");

/** The canonical role → permission map (seeded by migration; checked against the DB at boot). */
export const ROLE_PERMISSIONS: Readonly<Record<RoleKey, readonly Permission[]>> = {
  owner: ALL_PERMISSIONS.filter((p) => !PHARMACIST_ONLY.includes(p) && !isOwnScoped(p)),
  pharmacist_titular: [
    PERMISSIONS.orders.read,
    PERMISSIONS.orders.reviewDecide,
    PERMISSIONS.catalog.read,
    PERMISSIONS.pharmacy.pharmacistsManage,
  ],
  pharmacist: [PERMISSIONS.orders.read, PERMISSIONS.orders.reviewDecide, PERMISSIONS.catalog.read],
  pharmacy_assistant: [PERMISSIONS.orders.read, PERMISSIONS.catalog.read],
  customer_service: [PERMISSIONS.orders.read],
  content_editor: [PERMISSIONS.catalog.read, PERMISSIONS.catalog.manage],
  customer: [PERMISSIONS.orders.create, PERMISSIONS.orders.readOwn, PERMISSIONS.catalog.read],
};

/** One row of `identity.role_permissions`. */
export interface RolePermissionRow {
  readonly roleKey: string;
  readonly permissionKey: string;
}

/** The code catalogue as `role_permissions` rows, sorted (for the seed and the drift check). */
export function codeRolePermissions(): RolePermissionRow[] {
  return ROLE_KEYS.flatMap((roleKey) =>
    ROLE_PERMISSIONS[roleKey].map((permissionKey) => ({ roleKey, permissionKey })),
  ).sort((a, b) =>
    a.roleKey === b.roleKey
      ? a.permissionKey.localeCompare(b.permissionKey)
      : a.roleKey.localeCompare(b.roleKey),
  );
}

let installed: ReadonlyMap<string, ReadonlySet<string>> | undefined;

/**
 * Installs the role → permission mapping read from the database (once per process, at boot).
 * `loadRbacCatalogue()` calls it after checking that the rows equal `codeRolePermissions()`.
 */
export function setRbacCatalogue(rows: readonly RolePermissionRow[]): void {
  const map = new Map<string, Set<string>>();
  for (const { roleKey, permissionKey } of rows) {
    const set = map.get(roleKey) ?? new Set<string>();
    set.add(permissionKey);
    map.set(roleKey, set);
  }
  installed = map;
}

/** Whether `setRbacCatalogue` has run in this process. */
export function rbacCatalogueLoaded(): boolean {
  return installed !== undefined;
}

/**
 * True when at least one of `roles` grants `permission`. Unknown roles grant nothing.
 * Throws `rbac.catalogue_not_loaded` until the catalogue is installed: a process that forgot to
 * load it fails loudly instead of authorizing from a stale copy.
 */
export function hasPermission(roles: readonly string[], permission: Permission): boolean {
  if (!installed) {
    throw new Error(
      "rbac.catalogue_not_loaded: call loadRbacCatalogue() at boot (tests: useCodeRbacCatalogue())",
    );
  }
  const catalogue = installed;
  return roles.some((role) => catalogue.get(role)?.has(permission) ?? false);
}

/** Test seam: installs the code catalogue without a database. Never call from production code. */
export function useCodeRbacCatalogue(): void {
  setRbacCatalogue(codeRolePermissions());
}
