/**
 * `@igs/rbac` (T-016, option C): the RBAC catalogue and the synchronous `hasPermission` check.
 * A leaf package with **no in-repo dependencies** (enforced by the boundaries config), so the kernel,
 * `@igs/auth` and the modules can all depend on it without a cycle.
 *
 * Callers (the kernel) depend only on `hasPermission(roles, permission)` (T-005a contract). Roles are
 * always resolved server-side from the session/DB by the edge adapter, never from client input (D-005).
 */
export {
  ALL_PERMISSIONS,
  PERMISSIONS,
  PHARMACIST_ONLY,
  PHARMACIST_ROLES,
  ROLES,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
  type Permission,
  type RoleDefinition,
  type RoleKey,
  type RoleKind,
  type RolePermissionRow,
  codeRolePermissions,
  rbacDrift,
} from "./catalogue";
export { hasPermission, rbacCatalogueLoaded, setRbacCatalogue } from "./install";
