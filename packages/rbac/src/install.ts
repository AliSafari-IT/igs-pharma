import type { Permission, RolePermissionRow } from "./catalogue";

/** role key → its permission keys. Null prototype and frozen all the way down: read-only once set. */
type Installed = Readonly<Record<string, readonly string[]>>;

let installed: Installed | undefined;

/**
 * Installs the role → permission mapping read from the database. **Once per process**, at boot
 * (`loadRbacCatalogue()` in `@igs/module-identity` calls it after checking the rows against the
 * code catalogue): a second call throws `rbac.catalogue_already_loaded`, and the installed mapping
 * is frozen, so nothing can widen a role's permissions at runtime.
 */
export function setRbacCatalogue(rows: readonly RolePermissionRow[]): void {
  if (installed) {
    throw new Error("rbac.catalogue_already_loaded: setRbacCatalogue() runs once per process");
  }
  const grouped = new Map<string, Set<string>>();
  for (const { roleKey, permissionKey } of rows) {
    const set = grouped.get(roleKey) ?? new Set<string>();
    set.add(permissionKey);
    grouped.set(roleKey, set);
  }
  const map: Record<string, readonly string[]> = Object.create(null);
  for (const [roleKey, keys] of grouped) map[roleKey] = Object.freeze([...keys].sort());
  installed = Object.freeze(map);
}

/** Whether `setRbacCatalogue` has run in this process. */
export function rbacCatalogueLoaded(): boolean {
  return installed !== undefined;
}

/**
 * True when at least one of `roles` grants `permission`. Unknown roles grant nothing.
 * **Fails closed**: throws `rbac.catalogue_not_loaded` until the catalogue is installed, so a
 * process that forgot to load it never authorizes from a stale or static copy.
 */
export function hasPermission(roles: readonly string[], permission: Permission): boolean {
  const catalogue = installed;
  if (!catalogue) {
    throw new Error(
      "rbac.catalogue_not_loaded: call loadRbacCatalogue() at boot (tests: useCodeRbacCatalogue())",
    );
  }
  return roles.some(
    (role) => Object.hasOwn(catalogue, role) && (catalogue[role]?.includes(permission) ?? false),
  );
}
