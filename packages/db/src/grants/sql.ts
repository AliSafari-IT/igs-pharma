import { APP_ROLE, type ObjectGrant, type SchemaGrants, WORKER_ROLE } from "./types";

const ROLES = [APP_ROLE, WORKER_ROLE] as const;
const BREAKPOINT = "\n--> statement-breakpoint\n";

const qi = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

/** `schema.table` → `"schema"."table"`. */
function qualified(name: string): string {
  const [schema, rest] = [name.slice(0, name.indexOf(".")), name.slice(name.indexOf(".") + 1)];
  return `${qi(schema)}.${qi(rest)}`;
}

/** `schema.fn(integer,date)` → `"schema"."fn"(integer,date)`. */
function qualifiedFunction(name: string): string {
  const open = name.indexOf("(");
  return `${qualified(name.slice(0, open))}${name.slice(open)}`;
}

function objectStatements(object: ObjectGrant): string[] {
  const out: string[] = [];
  if (object.kind === "table") {
    const target = qualified(object.name);
    if (object.app.length > 0)
      out.push(`GRANT ${object.app.join(", ")} ON ${target} TO ${qi(APP_ROLE)};`);
    if (object.worker.length > 0) {
      out.push(`GRANT ${object.worker.join(", ")} ON ${target} TO ${qi(WORKER_ROLE)};`);
    }
  } else {
    const target = qualifiedFunction(object.name);
    if (object.app) out.push(`GRANT EXECUTE ON FUNCTION ${target} TO ${qi(APP_ROLE)};`);
    if (object.worker) out.push(`GRANT EXECUTE ON FUNCTION ${target} TO ${qi(WORKER_ROLE)};`);
  }
  return out;
}

const fromAll = ["PUBLIC", ...ROLES.map(qi)].join(", ");

/** Strips every privilege in a schema from PUBLIC and the runtime roles, so the grants below converge. */
function resetStatements(schema: string): string[] {
  const s = qi(schema);
  return [
    `REVOKE ALL ON SCHEMA ${s} FROM ${fromAll};`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA ${s} FROM ${fromAll};`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${s} FROM ${fromAll};`,
    `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${s} FROM ${fromAll};`,
  ];
}

function usageStatements(grants: SchemaGrants): string[] {
  const s = qi(grants.schema);
  const out: string[] = [];
  if (grants.usage.app) out.push(`GRANT USAGE ON SCHEMA ${s} TO ${qi(APP_ROLE)};`);
  if (grants.usage.worker) out.push(`GRANT USAGE ON SCHEMA ${s} TO ${qi(WORKER_ROLE)};`);
  return out;
}

/**
 * The ownership and role-attribute assertion (igs-pharma#66). It only REPORTS: it lists every
 * offending object and role and raises, and never changes an owner (a migration run by the
 * administrative role cannot safely `REASSIGN OWNED` a role it does not control).
 */
function assertionStatement(schemas: readonly string[]): string {
  const list = schemas.map((s) => `'${s}'`).join(", ");
  const roles = ROLES.map((r) => `'${r}'`).join(", ");
  // owned by a runtime role OR by a role that is (transitively) a member of one: a login mapped to
  // a group would keep every right its own objects give it, including DDL. Not `pg_has_role(.., 'MEMBER')`:
  // that is true for every superuser.
  const runtime = (owner: string) => `${owner} IN (SELECT oid FROM runtime)`;
  return `DO $$
DECLARE
  offenders text;
BEGIN
  WITH RECURSIVE runtime(oid) AS (
    SELECT oid FROM pg_roles WHERE rolname IN (${roles})
    UNION
    SELECT m.member FROM pg_auth_members m JOIN runtime r ON m.roleid = r.oid
  )
  SELECT string_agg(kind || ' ' || name || ' is owned by ' || owner, E'\\n' ORDER BY kind, name)
    INTO offenders
  FROM (
    SELECT 'relation' AS kind, n.nspname || '.' || c.relname AS name, pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN (${list}) AND ${runtime("c.relowner")}
    UNION ALL
    SELECT 'function', p.oid::regprocedure::text, pg_get_userbyid(p.proowner)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN (${list}) AND ${runtime("p.proowner")}
    UNION ALL
    SELECT 'schema', n.nspname, pg_get_userbyid(n.nspowner)
      FROM pg_namespace n
      WHERE n.nspname IN (${list}) AND ${runtime("n.nspowner")}
  ) owned;
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION E'igs-pharma#66: the runtime roles (and their members) must not own objects; the administrative role must. Offenders:\\n%', offenders
      USING ERRCODE = '42501';
  END IF;

  -- the runtime roles, and whoever is a member of them, must be unprivileged login/group roles
  SELECT string_agg(r.rolname || ' (' || concat_ws(', ',
      CASE WHEN r.rolsuper THEN 'superuser' END,
      CASE WHEN r.rolcreaterole THEN 'CREATEROLE' END,
      CASE WHEN r.rolcreatedb THEN 'CREATEDB' END,
      CASE WHEN r.rolbypassrls THEN 'BYPASSRLS' END,
      CASE WHEN pg_has_role(r.oid, current_user, 'MEMBER') AND r.rolname <> current_user
        THEN 'member of the administrative role ' || current_user END) || ')',
    E'\\n' ORDER BY r.rolname)
    INTO offenders
  FROM pg_roles r
  WHERE (r.rolname IN (${roles})
      OR r.oid IN (SELECT m.member FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid WHERE g.rolname IN (${roles})))
    AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls
      OR (pg_has_role(r.oid, current_user, 'MEMBER') AND r.rolname <> current_user));
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION E'igs-pharma#66: the runtime roles must be plain roles that are not superuser, CREATEROLE, CREATEDB, BYPASSRLS or members of the administrative role. Offenders:\\n%', offenders
      USING ERRCODE = '42501';
  END IF;
END
$$;`;
}

/** The migration that introduced the runtime grants (resets each schema, then grants the manifest). */
export const GRANTS_MIGRATION = 26;

/**
 * The SQL of a grants migration for `schemas`.
 *
 * - `migration: 26` (default; `0026_runtime_grants.sql`): the ownership/role assertion FIRST (so a
 *   non-superuser administrator gets the actionable offender list instead of a bare `permission
 *   denied` from the first REVOKE), then, per schema, a reset of PUBLIC and the runtime roles and
 *   exactly the manifest entries introduced up to 26. Idempotent: it converges on a database whose
 *   grants were made by hand. No `ALTER DEFAULT PRIVILEGES`.
 * - any later `migration: N`: only the `GRANT`s of the entries with `since: N` (a module's own
 *   migration, D-036), no reset.
 */
export function renderGrantsSql(
  schemas: readonly SchemaGrants[],
  options: { migration?: number } = {},
): string {
  const migration = options.migration ?? GRANTS_MIGRATION;
  const statements: string[] = [];
  if (migration === GRANTS_MIGRATION) {
    // pgboss is checked too: it is installed by the migrate entry, so on a first run it does not exist yet
    statements.push(assertionStatement([...schemas.map((g) => g.schema), "pgboss"]));
  }
  for (const grants of schemas) {
    const objects = grants.objects.filter((o) =>
      migration === GRANTS_MIGRATION
        ? (o.since ?? GRANTS_MIGRATION) <= GRANTS_MIGRATION
        : o.since === migration,
    );
    if (migration === GRANTS_MIGRATION) {
      statements.push(...resetStatements(grants.schema));
      statements.push(...usageStatements(grants));
    }
    for (const object of objects) statements.push(...objectStatements(object));
  }
  return statements.join(BREAKPOINT);
}

/**
 * The grants of the `pgboss` schema, as statements to run (not a migration file): the migrate
 * entry installs the schema after the Drizzle migrations and creates the queues, then applies
 * these, so the worker may use pg-boss at runtime (DML, no DDL) and `igs_app` may not touch it.
 */
export function renderPgbossGrantsSql(): string[] {
  const s = qi("pgboss");
  const worker = qi(WORKER_ROLE);
  return [
    ...resetStatements("pgboss"),
    `GRANT USAGE ON SCHEMA ${s} TO ${worker};`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${s} TO ${worker};`,
    // pg-boss's supervisor and scheduler UPDATE the bookkeeping columns of its one-row version table
    // (maintained_on, cron_on); the row itself is created and replaced by the migrate entry only
    `REVOKE INSERT, DELETE ON ${s}.${qi("version")} FROM ${worker};`,
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${s} TO ${worker};`,
    `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${s} TO ${worker};`,
  ];
}

/**
 * The same statements as ONE multi-statement string. Sent as a single simple-protocol query (no
 * parameters) Postgres runs it in one implicit transaction, so a crash or error in the middle
 * rolls the whole thing back instead of leaving the worker role without its `pgboss` privileges.
 */
export function renderPgbossGrantsScript(): string {
  return renderPgbossGrantsSql().join("\n");
}
