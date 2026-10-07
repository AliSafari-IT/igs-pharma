/**
 * Phase 0 stub — RBAC permission definitions.
 * Full RBAC/ABAC implementation in Phase 1a.
 */

export const PERMISSIONS = {
  orders: {
    read: "orders.read",
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

const ROLE_PERMISSIONS: Readonly<Record<string, readonly Permission[]>> = {
  owner: ALL,
  pharmacist_titular: [
    PERMISSIONS.orders.read,
    PERMISSIONS.orders.reviewDecide,
    PERMISSIONS.catalog.read,
  ],
  pharmacist: [PERMISSIONS.orders.read, PERMISSIONS.orders.reviewDecide, PERMISSIONS.catalog.read],
  pharmacy_assistant: [PERMISSIONS.orders.read, PERMISSIONS.catalog.read],
  customer_service: [PERMISSIONS.orders.read],
  content_editor: [PERMISSIONS.catalog.read, PERMISSIONS.catalog.manage],
  customer: [PERMISSIONS.orders.create, PERMISSIONS.orders.read, PERMISSIONS.catalog.read],
};

/** True when at least one of `roles` grants `permission`. Unknown roles grant nothing. */
export function hasPermission(roles: readonly string[], permission: Permission): boolean {
  return roles.some((role) => ROLE_PERMISSIONS[role]?.includes(permission) ?? false);
}
