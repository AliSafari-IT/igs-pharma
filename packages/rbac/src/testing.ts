/**
 * TEST-ONLY (`@igs/rbac/testing`, A8): importable only from test code, like `@igs/db/testing`.
 */
import { codeRolePermissions } from "./catalogue";
import { rbacCatalogueLoaded, setRbacCatalogue } from "./install";

/**
 * Installs the code catalogue without a database, so `hasPermission` works in unit tests. Call it
 * from a vitest `setupFiles` entry (each test file gets a fresh module graph). A no-op when a
 * catalogue is already installed; never call from production code.
 */
export function useCodeRbacCatalogue(): void {
  if (!rbacCatalogueLoaded()) setRbacCatalogue(codeRolePermissions());
}
