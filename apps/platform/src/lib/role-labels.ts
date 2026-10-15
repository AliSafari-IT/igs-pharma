import { ROLES, ROLE_KEYS, type RoleKey } from "@igs/rbac";

/** The catalogue roles a person on the staff side can hold (customer and system roles are not shown). */
export type StaffRoleKey = {
  [K in RoleKey]: (typeof ROLES)[K]["kind"] extends "staff" ? K : never;
}[RoleKey];

/**
 * The English names staff see for their roles (igs-pharma#112 V1). Typed over every staff role of
 * `@igs/rbac`, so a new staff role does not compile until it has a name here.
 */
export const STAFF_ROLE_LABELS: Readonly<Record<StaffRoleKey, string>> = {
  owner: "Owner",
  pharmacist_titular: "Titular pharmacist",
  pharmacist: "Pharmacist",
  pharmacy_assistant: "Pharmacy assistant",
  customer_service: "Customer service",
  content_editor: "Content editor",
};

const isStaffRole = (role: RoleKey): role is StaffRoleKey => ROLES[role].kind === "staff";

/**
 * The roles shown under a staff member's name in the top bar: the staff roles they hold, in
 * catalogue order, joined with ", ". Unknown, customer and system keys are left out; `""` when none
 * is left. Display only: what a member may do is still decided by the permission checks (D-005).
 */
export function staffRoleSummary(roles: readonly string[]): string {
  return ROLE_KEYS.filter(isStaffRole)
    .filter((role) => roles.includes(role))
    .map((role) => STAFF_ROLE_LABELS[role])
    .join(", ");
}
