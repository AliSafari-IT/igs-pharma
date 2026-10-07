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

export type Permission =
  (typeof PERMISSIONS)[keyof typeof PERMISSIONS][keyof (typeof PERMISSIONS)[keyof typeof PERMISSIONS]];
