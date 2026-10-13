import type { SchemaGrants } from "./types";

/**
 * pg-boss's own schema is created by the migrate entry (D-021), after the Drizzle migrations, so it
 * is not part of the migration SQL: the migrate entry applies these grants right after
 * `boss.start()`. Tables and functions are discovered from the catalog at that time (pg-boss
 * versions change them and adds a table per queue), so there is no per-object list: the worker may
 * use all of them at runtime (DML, no DDL); `igs_app` gets nothing.
 */
export const pgboss: SchemaGrants = {
  schema: "pgboss",
  usage: { app: false, worker: true },
  objects: [],
};
