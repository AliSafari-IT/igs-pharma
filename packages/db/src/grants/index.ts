export * from "./types";
export {
  GRANTS_MIGRATION,
  renderGrantsSql,
  renderPgbossGrantsScript,
  renderPgbossGrantsSql,
} from "./sql";

import { audit } from "./audit";
import { catalog } from "./catalog";
import { identity } from "./identity";
import { inventory } from "./inventory";
import { pgboss } from "./pgboss";
import { pricing } from "./pricing";
import { privacy } from "./privacy";
import { system } from "./system";
import type { SchemaGrants } from "./types";

export { pgboss };

/** Every schema owned by the repo's migrations (not `pgboss`, which the migrate entry installs). */
export const APP_SCHEMAS: readonly SchemaGrants[] = [
  audit,
  catalog,
  identity,
  inventory,
  pricing,
  privacy,
  system,
];
