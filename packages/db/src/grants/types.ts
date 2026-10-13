/**
 * Runtime grant manifest (igs-pharma#66, D-036): exactly what the two runtime roles may do, one file
 * per schema. `packages/db` imports no module (D-001), so objects are plain `"schema.name"` keys.
 *
 * - `igs_app`    web + platform;
 * - `igs_worker` the worker, ADDITIVE to `igs_app`: its login role is a member of both, so it
 *                holds `app ∪ worker`. A `worker` list is what `igs_worker` itself is granted; it may
 *                repeat `app` entries that migration 0007 already gave `igs_worker` directly.
 *
 * The DB-state test (`test/grants.test.ts`) compares the database with this manifest in both
 * directions, so an object without an entry, an entry without an object, or a privilege that differs
 * all fail the build. A module that adds a table adds its entry here AND its own `GRANT`s in its
 * migration; nothing is granted by default (no `ALTER DEFAULT PRIVILEGES`).
 */

export const APP_ROLE = "igs_app";
export const WORKER_ROLE = "igs_worker";
export type RuntimeRole = typeof APP_ROLE | typeof WORKER_ROLE;

export type TablePrivilege = "SELECT" | "INSERT" | "UPDATE" | "DELETE";

/**
 * How a table is used, for readers and for the tests:
 * - `append_only`: rows are inserted and never changed (trigger-enforced); no UPDATE/DELETE grant;
 * - `catalogue`: filled by migrations; the runtime only reads;
 * - `mutable`: ordinary read-write state.
 */
export type TableClass = "append_only" | "catalogue" | "mutable";

export interface TableGrant {
  readonly kind: "table";
  /** `schema.table` */
  readonly name: string;
  readonly class: TableClass;
  readonly app: readonly TablePrivilege[];
  /** Granted to `igs_worker` itself (the worker login also holds `app`). */
  readonly worker: readonly TablePrivilege[];
  /** Why, when it is not obvious. */
  readonly note?: string;
  /** The grants migration that introduced the entry (default 26, `0026_runtime_grants`). */
  readonly since?: number;
}

export interface FunctionGrant {
  readonly kind: "function";
  /** `schema.name(argument types)`, as `pg_proc.oid::regprocedure` prints it. */
  readonly name: string;
  readonly app: boolean;
  /** Granted to `igs_worker` itself (the worker login also holds `app`). */
  readonly worker: boolean;
  readonly note?: string;
  /** See `TableGrant.since`. */
  readonly since?: number;
}

export type ObjectGrant = TableGrant | FunctionGrant;

export interface SchemaGrants {
  readonly schema: string;
  /** Who gets `USAGE` on the schema (never `CREATE`). */
  readonly usage: { readonly app: boolean; readonly worker: boolean };
  readonly objects: readonly ObjectGrant[];
}

export const table = (
  name: string,
  cls: TableClass,
  grants: {
    app?: readonly TablePrivilege[];
    worker?: readonly TablePrivilege[];
    note?: string;
    since?: number;
  },
): TableGrant => ({
  kind: "table",
  name,
  class: cls,
  app: grants.app ?? [],
  worker: grants.worker ?? [],
  ...(grants.note ? { note: grants.note } : {}),
  ...(grants.since ? { since: grants.since } : {}),
});

export const fn = (
  name: string,
  grants: { app?: boolean; worker?: boolean; note?: string; since?: number },
): FunctionGrant => ({
  kind: "function",
  name,
  app: grants.app ?? false,
  worker: grants.worker ?? false,
  ...(grants.note ? { note: grants.note } : {}),
  ...(grants.since ? { since: grants.since } : {}),
});
