/**
 * Phase 0 stub — RBAC permission definitions.
 * Full RBAC/ABAC implementation in Phase 1a.
 */

export const PERMISSIONS = {
  orders: {
    /** Staff-wide access to orders. Customers hold `readOwn` instead (B-02 generalises `.own`/`.any`). */
    read: "orders.read",
    /** Customer access to their OWN orders: handlers must check ownership against `ctx.actor.id`. */
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
    manage: "staff.manage",
  },
} as const;

/** Values of every group, distributed over the union (indexing a union by `keyof` yields `never`). */
type GroupValues<G> = G extends unknown ? G[keyof G] : never;

export type Permission = GroupValues<(typeof PERMISSIONS)[keyof typeof PERMISSIONS]>;

/**
 * Role → permissions, **provisional** (T-005a, Q2): a static map until the DB-backed RBAC tables
 * land in B-02, which swaps the implementation of `hasPermission` and nothing else.
 * Callers (the kernel) depend only on `hasPermission(roles, permission)`.
 *
 * Roles must always be resolved server-side from the session/DB by the edge adapter, never taken
 * from client input (D-005).
 */
const ALL: readonly Permission[] = Object.values(PERMISSIONS).flatMap((group) =>
  Object.values(group),
);

/**
 * Pharmacist-only permissions (REQ-PHC-01/05): never implied by `owner` or any administrative
 * role. A person who is both owner and pharmacist simply holds both roles (D-030).
 */
const PHARMACIST_ONLY: readonly Permission[] = [PERMISSIONS.orders.reviewDecide];

const ROLE_PERMISSIONS: Readonly<Record<string, readonly Permission[]>> = {
  owner: ALL.filter((permission) => !PHARMACIST_ONLY.includes(permission)),
  pharmacist_titular: [
    PERMISSIONS.orders.read,
    PERMISSIONS.orders.reviewDecide,
    PERMISSIONS.catalog.read,
  ],
  pharmacist: [PERMISSIONS.orders.read, PERMISSIONS.orders.reviewDecide, PERMISSIONS.catalog.read],
  pharmacy_assistant: [PERMISSIONS.orders.read, PERMISSIONS.catalog.read],
  customer_service: [PERMISSIONS.orders.read],
  content_editor: [PERMISSIONS.catalog.read, PERMISSIONS.catalog.manage],
  customer: [PERMISSIONS.orders.create, PERMISSIONS.orders.readOwn, PERMISSIONS.catalog.read],
};

/** True when at least one of `roles` grants `permission`. Unknown roles grant nothing. */
export function hasPermission(roles: readonly string[], permission: Permission): boolean {
  return roles.some((role) => ROLE_PERMISSIONS[role]?.includes(permission) ?? false);
}
