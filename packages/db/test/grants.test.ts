// The runtime roles' privileges as code (igs-pharma#66, D-036) against real Postgres: migrate as a
// NON-superuser administrative role, then compare the database with the manifest in
// `src/grants/` in both directions, and connect as the runtime roles to prove what they cannot do.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  APP_ROLE,
  APP_SCHEMAS,
  type FunctionGrant,
  type TableGrant,
  type TablePrivilege,
  WORKER_ROLE,
  pgboss,
  renderGrantsSql,
  renderPgbossGrantsScript,
} from "../src/grants";
import { type RuntimeRoleDatabase, createRuntimeRoleDatabase } from "../src/testing";

/** How many migrations are committed (the journal), so a new one does not break the counts below. */
const committedMigrations = (): number =>
  (
    JSON.parse(
      fs.readFileSync(
        fileURLToPath(new URL("../drizzle/meta/_journal.json", import.meta.url)),
        "utf8",
      ),
    ) as { entries: unknown[] }
  ).entries.length;

const ALL_TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;

const tables = APP_SCHEMAS.flatMap((s) => s.objects).filter(
  (o): o is TableGrant => o.kind === "table",
);
const functions = APP_SCHEMAS.flatMap((s) => s.objects).filter(
  (o): o is FunctionGrant => o.kind === "function",
);

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return String((error as { code?: string }).code ?? error);
  }
  return "ok";
}

/** Everything the manifest says, checked against the database, for the two group roles and the logins. */
async function expectDatabaseMatchesManifest(db: RuntimeRoleDatabase, admin: postgres.Sql) {
  // 1. drift: every table / sequence / function in the app schemas has an entry, and vice versa
  const schemaNames = APP_SCHEMAS.map((s) => s.schema);
  const relations = await admin<{ name: string }[]>`
    SELECT n.nspname || '.' || c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY(${schemaNames}) AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
      AND NOT c.relispartition AND NOT EXISTS (
        SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('i', 'a') AND c.relkind = 'S')`;
  expect(
    relations.map((r) => r.name).sort(),
    "tables without a manifest entry, or vice versa",
  ).toEqual(tables.map((t) => t.name).sort());
  const procs = await admin<{ name: string }[]>`
    SELECT p.oid::regprocedure::text AS name
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = ANY(${schemaNames})`;
  expect(
    procs.map((p) => p.name).sort(),
    "functions without a manifest entry, or vice versa",
  ).toEqual(functions.map((f) => f.name).sort());
  const userSchemas = await admin<{ nspname: string }[]>`
    SELECT nspname FROM pg_namespace
    WHERE nspname NOT LIKE 'pg\\_%' AND nspname NOT IN ('information_schema', 'public', 'drizzle', 'pgboss')`;
  expect(userSchemas.map((s) => s.nspname).sort(), "a schema without a manifest file").toEqual(
    [...schemaNames].sort(),
  );

  // 2. privileges, exactly: group roles directly, logins through membership
  const has = async (role: string, table: string, privilege: string) =>
    (
      await admin<
        { ok: boolean }[]
      >`SELECT has_table_privilege(${role}, ${table}, ${privilege}) AS ok`
    )[0]?.ok === true;
  const canExecute = async (role: string, fn: string) =>
    (
      await admin<{ ok: boolean }[]>`SELECT has_function_privilege(${role}, ${fn}, 'EXECUTE') AS ok`
    )[0]?.ok === true;

  const wanted = (list: readonly TablePrivilege[], privilege: string) =>
    (list as readonly string[]).includes(privilege);
  for (const t of tables) {
    for (const privilege of ALL_TABLE_PRIVILEGES) {
      const app = wanted(t.app, privilege);
      const worker = wanted(t.worker, privilege);
      const label = `${t.name} ${privilege}`;
      expect(await has(APP_ROLE, t.name, privilege), `igs_app ${label}`).toBe(app);
      expect(await has(WORKER_ROLE, t.name, privilege), `igs_worker ${label}`).toBe(worker);
      expect(await has(db.appRole, t.name, privilege), `app login ${label}`).toBe(app);
      expect(await has(db.workerRole, t.name, privilege), `worker login ${label}`).toBe(
        app || worker,
      );
    }
  }
  for (const f of functions) {
    expect(await canExecute(APP_ROLE, f.name), `igs_app EXECUTE ${f.name}`).toBe(f.app);
    expect(await canExecute(WORKER_ROLE, f.name), `igs_worker EXECUTE ${f.name}`).toBe(f.worker);
    expect(await canExecute(db.appRole, f.name), `app login EXECUTE ${f.name}`).toBe(f.app);
    expect(await canExecute(db.workerRole, f.name), `worker login EXECUTE ${f.name}`).toBe(
      f.app || f.worker,
    );
  }
  for (const s of APP_SCHEMAS) {
    const usage = async (role: string) =>
      (
        await admin<
          { ok: boolean }[]
        >`SELECT has_schema_privilege(${role}, ${s.schema}, 'USAGE') AS ok`
      )[0]?.ok === true;
    expect(await usage(APP_ROLE), `igs_app USAGE ${s.schema}`).toBe(s.usage.app);
    expect(await usage(WORKER_ROLE), `igs_worker USAGE ${s.schema}`).toBe(s.usage.worker);
  }
  // nobody can CREATE anywhere: not in the app schemas, not in public, not in the database
  for (const role of [APP_ROLE, WORKER_ROLE, db.appRole, db.workerRole]) {
    for (const schema of [...schemaNames, "public"]) {
      const [row] = await admin<{ ok: boolean }[]>`
        SELECT has_schema_privilege(${role}, ${schema}, 'CREATE') AS ok`;
      expect(row?.ok, `${role} CREATE in ${schema}`).toBe(false);
    }
    const [dbRow] = await admin<{ ok: boolean }[]>`
      SELECT has_database_privilege(${role}, current_database(), 'CREATE') AS ok`;
    expect(dbRow?.ok, `${role} CREATE on the database`).toBe(false);
  }

  // 3. nothing for PUBLIC in the app schemas (tables, partitions, functions, schemas)
  const publicAcls = await admin<{ what: string }[]>`
    SELECT 'relation ' || n.nspname || '.' || c.relname AS what
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
           LATERAL aclexplode(c.relacl) a
      WHERE n.nspname = ANY(${schemaNames}) AND a.grantee = 0
    UNION ALL
    SELECT 'function ' || p.oid::regprocedure::text
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
           LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      WHERE n.nspname = ANY(${schemaNames}) AND a.grantee = 0
    UNION ALL
    SELECT 'schema ' || n.nspname
      FROM pg_namespace n, LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
      WHERE n.nspname = ANY(${schemaNames}) AND a.grantee = 0`;
  expect(
    publicAcls.map((r) => r.what),
    "privileges left for PUBLIC",
  ).toEqual([]);

  // 4. no default privileges would hand a future table to the runtime roles
  const defaults = await admin<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) a
    WHERE a.grantee IN (SELECT oid FROM pg_roles WHERE rolname = ANY(${[APP_ROLE, WORKER_ROLE]}))
       OR d.defaclrole IN (SELECT oid FROM pg_roles WHERE rolname = ANY(${[APP_ROLE, WORKER_ROLE]}))`;
  expect(defaults[0]?.n, "ALTER DEFAULT PRIVILEGES for a runtime role").toBe(0);

  // 5. ownership: nothing owned by the runtime roles; the administrative role owns the schemas
  const owned = await admin<{ what: string; owner: string }[]>`
    SELECT 'relation ' || n.nspname || '.' || c.relname AS what, pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ANY(${schemaNames})
    UNION ALL
    SELECT 'function ' || p.oid::regprocedure::text, pg_get_userbyid(p.proowner)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ANY(${schemaNames})
    UNION ALL
    SELECT 'schema ' || n.nspname, pg_get_userbyid(n.nspowner) FROM pg_namespace n
      WHERE n.nspname = ANY(${schemaNames})`;
  expect(
    owned
      .filter((o) => ![db.adminRole].includes(o.owner))
      .map((o) => `${o.what} owned by ${o.owner}`),
    "objects not owned by the administrative role",
  ).toEqual([]);

  // 6. the runtime roles are plain roles
  const attrs = await admin<{ rolname: string; bad: boolean; member: boolean }[]>`
    SELECT rolname,
      (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls) AS bad,
      pg_has_role(oid, ${db.adminRole}, 'MEMBER') AS member
    FROM pg_roles WHERE rolname = ANY(${[APP_ROLE, WORKER_ROLE, db.appRole, db.workerRole]})`;
  expect(attrs).toHaveLength(4);
  for (const row of attrs) {
    expect(row.bad, `${row.rolname} has a powerful attribute`).toBe(false);
    expect(row.member, `${row.rolname} is a member of the administrative role`).toBe(false);
  }
}

describe("runtime grants", () => {
  let db: RuntimeRoleDatabase;
  let admin: postgres.Sql;
  let app: postgres.Sql;
  let worker: postgres.Sql;

  beforeAll(async () => {
    db = await createRuntimeRoleDatabase();
    await db.migrate(); // as a non-superuser: nothing in the chain may need a superuser
    admin = postgres(db.superUrl, { max: 2, onnotice: () => {} });
    app = postgres(db.appUrl, { max: 2, onnotice: () => {} });
    worker = postgres(db.workerUrl, { max: 2, onnotice: () => {} });
  }, 120_000);

  afterAll(async () => {
    await Promise.all([
      admin?.end({ timeout: 5 }),
      app?.end({ timeout: 5 }),
      worker?.end({ timeout: 5 }),
    ]);
    await db?.drop();
  });

  it("the migrating role is not a superuser", async () => {
    const [row] = await admin<{ rolsuper: boolean }[]>`
      SELECT rolsuper FROM pg_roles WHERE rolname = ${db.adminRole}`;
    expect(row?.rolsuper).toBe(false);
  });

  it("the database matches the manifest exactly: drift, privileges, PUBLIC, defaults, ownership", async () => {
    await expectDatabaseMatchesManifest(db, admin);
  });

  it("the append-only ledgers refuse UPDATE, DELETE and TRUNCATE (42501), but accept INSERT", async () => {
    const ledgers = tables.filter((t) => t.class === "append_only").map((t) => t.name);
    expect(ledgers.length).toBeGreaterThanOrEqual(5);
    for (const name of ledgers) {
      const [schema, table] = name.split(".");
      const target = `"${schema}"."${table}"`;
      for (const sql of [app, worker]) {
        expect(
          await codeOf(() => sql.unsafe(`UPDATE ${target} SET id = id WHERE false`)),
          name,
        ).toBe("42501");
        expect(await codeOf(() => sql.unsafe(`DELETE FROM ${target} WHERE false`)), name).toBe(
          "42501",
        );
        expect(await codeOf(() => sql.unsafe(`TRUNCATE ${target}`)), name).toBe("42501");
      }
    }
  });

  it("DDL is refused: DROP TRIGGER, CREATE TABLE in any schema, CREATE SCHEMA, ALTER TABLE", async () => {
    for (const sql of [app, worker]) {
      expect(
        await codeOf(() => sql.unsafe("DROP TRIGGER events_append_only_rows ON audit.events")),
      ).toBe("42501");
      for (const { schema } of [...APP_SCHEMAS, { schema: "public" }]) {
        expect(
          await codeOf(() => sql.unsafe(`CREATE TABLE "${schema}".t66 (id int)`)),
          schema,
        ).toBe("42501");
      }
      expect(await codeOf(() => sql.unsafe("CREATE SCHEMA t66"))).toBe("42501");
      expect(
        await codeOf(() => sql.unsafe("ALTER TABLE catalog.products ADD COLUMN t66 int")),
      ).toBe("42501");
      expect(await codeOf(() => sql.unsafe("DROP TABLE catalog.brands"))).toBe("42501");
    }
  });

  it("the RBAC catalogue and the other migration-filled tables are read-only", async () => {
    for (const name of tables.filter((t) => t.class === "catalogue").map((t) => t.name)) {
      expect(await codeOf(() => app.unsafe(`SELECT count(*) FROM ${name}`)), name).toBe("ok");
      for (const sql of [app, worker]) {
        expect(await codeOf(() => sql.unsafe(`DELETE FROM ${name} WHERE false`)), name).toBe(
          "42501",
        );
        expect(await codeOf(() => sql.unsafe(`INSERT INTO ${name} DEFAULT VALUES`)), name).toBe(
          "42501",
        );
      }
    }
  });

  it("audit.chain_head stays updatable (by design) but its row cannot be deleted", async () => {
    expect(
      await codeOf(() => app.unsafe("UPDATE audit.chain_head SET seq = seq WHERE id = 1")),
    ).toBe("ok");
    expect(await codeOf(() => app.unsafe("DELETE FROM audit.chain_head"))).toBe("42501");
    expect(
      await codeOf(() =>
        app.unsafe(`INSERT INTO audit.chain_head (id, seq, hash) VALUES (2, 0, 'x')`),
      ),
    ).toBe("42501");
  });

  it("ensure_partitions is for nobody; maintain_partitions is the worker's alone", async () => {
    expect(await codeOf(() => app.unsafe("SELECT audit.ensure_partitions(1)"))).toBe("42501");
    expect(await codeOf(() => worker.unsafe("SELECT audit.ensure_partitions(1)"))).toBe("42501");
    expect(await codeOf(() => app.unsafe("SELECT audit.maintain_partitions()"))).toBe("42501");
    expect(await codeOf(() => worker.unsafe("SELECT audit.maintain_partitions()"))).toBe("ok");
    expect(await codeOf(() => app.unsafe("SELECT audit.future_partitions()"))).toBe("ok");
  });

  it("only the worker may purge the outbox and idempotency keys; the app may not even read the outbox", async () => {
    expect(await codeOf(() => app.unsafe("DELETE FROM system.idempotency_keys WHERE false"))).toBe(
      "42501",
    );
    expect(
      await codeOf(() => worker.unsafe("DELETE FROM system.idempotency_keys WHERE false")),
    ).toBe("ok");
    expect(await codeOf(() => app.unsafe("DELETE FROM system.outbox WHERE false"))).toBe("42501");
    expect(await codeOf(() => worker.unsafe("DELETE FROM system.outbox WHERE false"))).toBe("ok");
    expect(await codeOf(() => app.unsafe("SELECT 1 FROM system.outbox"))).toBe("42501");
  });

  it("the migration only CHECKS the pgboss schema (the migrate entry grants it)", () => {
    expect(pgboss.schema).toBe("pgboss");
    expect(renderGrantsSql(APP_SCHEMAS)).not.toMatch(/(GRANT|REVOKE)[^;]*pgboss/);
  });
});

describe("a database built the old way converges, and the migration is idempotent", () => {
  let db: RuntimeRoleDatabase;
  let admin: postgres.Sql;

  beforeAll(async () => {
    db = await createRuntimeRoleDatabase();
    const previous = 25; // the chain before 0026: no grants except audit's
    await db.migrate({ upTo: previous });
    admin = postgres(db.superUrl, { max: 2, onnotice: () => {} });
    // simulate grants made by hand on the server: broad, on every schema, plus PUBLIC and defaults
    // the schemas that exist before 0026 (a later one, like `orders`, is created by its own migration)
    for (const { schema } of APP_SCHEMAS.filter((s) => (s.since ?? 26) <= 26)) {
      await admin.unsafe(
        `GRANT USAGE, CREATE ON SCHEMA "${schema}" TO "${APP_ROLE}", "${WORKER_ROLE}"`,
      );
      await admin.unsafe(`GRANT ALL ON ALL TABLES IN SCHEMA "${schema}" TO "${APP_ROLE}"`);
      await admin.unsafe(`GRANT ALL ON ALL TABLES IN SCHEMA "${schema}" TO PUBLIC`);
      await admin.unsafe(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA "${schema}" TO PUBLIC`);
    }
    await admin.unsafe(`GRANT ALL ON ALL TABLES IN SCHEMA audit TO "${WORKER_ROLE}"`);
  }, 120_000);

  afterAll(async () => {
    await admin?.end({ timeout: 5 });
    await db?.drop();
  });

  it("really starts out broader than the manifest", async () => {
    const [row] = await admin<{ ok: boolean }[]>`
      SELECT has_table_privilege(${APP_ROLE}, 'audit.events', 'DELETE') AS ok`;
    expect(row?.ok).toBe(true);
  });

  it("0026 brings it to exactly the manifest, and running its SQL again changes nothing", async () => {
    await db.migrate(); // applies only 0026
    await expectDatabaseMatchesManifest(db, admin);
    // re-running 0026 resets every schema, so the later grants migrations (entries with `since`) run
    // again after it, in order, exactly as on a fresh database
    const later = [...new Set([...tables, ...functions].map((o) => o.since ?? 26))]
      .filter((n) => n > 26)
      .sort((a, b) => a - b);
    const script = [
      renderGrantsSql(APP_SCHEMAS),
      ...later.map((n) => renderGrantsSql(APP_SCHEMAS, { migration: n })),
    ].join("\n--> statement-breakpoint\n");
    for (const statement of script.split("\n--> statement-breakpoint\n")) {
      if (statement.trim() !== "") await admin.unsafe(statement);
    }
    await expectDatabaseMatchesManifest(db, admin);
    // it applies every migration after 0025 (the chain grows with each one), like the beforeAll that
    // builds the other databases: the same budget, not the 30-second default (igs-pharma#214 CI)
  }, 120_000);
});

describe("the ownership assertion", () => {
  let db: RuntimeRoleDatabase;
  let admin: postgres.Sql;
  let asAdministrator: postgres.Sql;

  beforeAll(async () => {
    db = await createRuntimeRoleDatabase();
    await db.migrate();
    admin = postgres(db.superUrl, { max: 2, onnotice: () => {} });
    asAdministrator = postgres(db.adminUrl, { max: 1, onnotice: () => {} });
  }, 120_000);

  afterAll(async () => {
    await Promise.all([admin?.end({ timeout: 5 }), asAdministrator?.end({ timeout: 5 })]);
    await db?.drop();
  });

  /** The migration's assertion statement, run as the administrative role like the migration is. */
  const run = async () => {
    const assertion = renderGrantsSql(APP_SCHEMAS).split(
      "\n--> statement-breakpoint\n",
    )[0] as string;
    return asAdministrator.unsafe(assertion);
  };

  it("passes on a correct setup", async () => {
    await expect(run()).resolves.toBeDefined();
  });

  it("lists the offending object and does NOT move it when a runtime role owns something", async () => {
    await admin.unsafe(`ALTER TABLE catalog.brands OWNER TO "${APP_ROLE}"`);
    try {
      await expect(run()).rejects.toThrow(/relation catalog\.brands is owned by igs_app/);
      const [row] = await admin<{ owner: string }[]>`
        SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'catalog.brands'::regclass`;
      expect(row?.owner).toBe(APP_ROLE);
    } finally {
      await admin.unsafe(`ALTER TABLE catalog.brands OWNER TO "${db.adminRole}"`);
    }
  });

  it("also catches an object owned by a MEMBER of a runtime role (a login mapped to igs_app)", async () => {
    await admin.unsafe(`ALTER TABLE catalog.brands OWNER TO "${db.appRole}"`);
    try {
      await expect(run()).rejects.toThrow(
        new RegExp(`relation catalog\\.brands is owned by ${db.appRole}`),
      );
    } finally {
      await admin.unsafe(`ALTER TABLE catalog.brands OWNER TO "${db.adminRole}"`);
    }
    await admin.unsafe(`ALTER FUNCTION audit.future_partitions() OWNER TO "${db.workerRole}"`);
    try {
      await expect(run()).rejects.toThrow(/function audit\.future_partitions\(\) is owned by/);
    } finally {
      await admin.unsafe(`ALTER FUNCTION audit.future_partitions() OWNER TO "${db.adminRole}"`);
    }
  });

  it("covers the pgboss schema too (old workers created queues at runtime)", async () => {
    await admin.unsafe(`CREATE SCHEMA pgboss AUTHORIZATION "${db.workerRole}"`);
    try {
      await expect(run()).rejects.toThrow(/schema pgboss is owned by/);
    } finally {
      await admin.unsafe("DROP SCHEMA pgboss");
    }
  });

  it("rejects a runtime role that is a superuser, CREATEROLE, CREATEDB, BYPASSRLS or the admin's member", async () => {
    for (const attribute of ["SUPERUSER", "CREATEROLE", "CREATEDB", "BYPASSRLS"]) {
      await admin.unsafe(`ALTER ROLE "${db.appRole}" ${attribute}`);
      try {
        await expect(run(), attribute).rejects.toThrow(new RegExp(db.appRole));
      } finally {
        await admin.unsafe(`ALTER ROLE "${db.appRole}" NO${attribute}`);
      }
    }
    await admin.unsafe(`GRANT "${db.adminRole}" TO "${APP_ROLE}"`);
    try {
      await expect(run()).rejects.toThrow(/member of the administrative role/);
    } finally {
      await admin.unsafe(`REVOKE "${db.adminRole}" FROM "${APP_ROLE}"`);
    }
  });
});

describe("migrating as the administrator over a member-owned object", () => {
  let db: RuntimeRoleDatabase;
  let admin: postgres.Sql;

  beforeAll(async () => {
    db = await createRuntimeRoleDatabase();
    await db.migrate({ upTo: 25 }); // the chain before 0026; also maps the logins to the groups
    admin = postgres(db.superUrl, { max: 2, onnotice: () => {} });
    await admin.unsafe(`ALTER TABLE catalog.brands OWNER TO "${db.appRole}"`);
  }, 120_000);

  afterAll(async () => {
    await admin?.end({ timeout: 5 });
    await db?.drop();
  });

  it("0026 stops FIRST with the offender list (not a bare 'permission denied'), and changes nothing", async () => {
    await expect(db.migrate()).rejects.toThrow(
      new RegExp(`relation catalog\\.brands is owned by ${db.appRole}`),
    );
    const [row] = await admin<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
    expect(row?.n).toBe(26); // 0000-0025 only; 0026 rolled back
    const [after] = await admin<{ owner: string }[]>`
      SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'catalog.brands'::regclass`;
    expect(after?.owner).toBe(db.appRole); // never moved by the migration
  });

  it("once the owner is fixed the same migration goes through", async () => {
    await admin.unsafe(`ALTER TABLE catalog.brands OWNER TO "${db.adminRole}"`);
    await db.migrate();
    const [row] = await admin<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
    expect(row?.n).toBe(committedMigrations()); // the whole chain, 0026 and everything after it
  });
});

describe("the pgboss grants are atomic", () => {
  let db: RuntimeRoleDatabase;
  let admin: postgres.Sql;
  let asAdministrator: postgres.Sql;

  beforeAll(async () => {
    db = await createRuntimeRoleDatabase();
    await db.migrate();
    admin = postgres(db.superUrl, { max: 2, onnotice: () => {} });
    asAdministrator = postgres(db.adminUrl, { max: 1, onnotice: () => {} });
    await asAdministrator.unsafe("CREATE SCHEMA pgboss");
    await asAdministrator.unsafe("CREATE TABLE pgboss.job (id int)");
    await asAdministrator.unsafe("CREATE TABLE pgboss.version (version int)");
  }, 120_000);

  afterAll(async () => {
    await Promise.all([admin?.end({ timeout: 5 }), asAdministrator?.end({ timeout: 5 })]);
    await db?.drop();
  });

  const can = async (table: string, privilege: string) =>
    (
      await admin<{ ok: boolean }[]>`
        SELECT has_table_privilege(${WORKER_ROLE}, ${table}, ${privilege}) AS ok`
    )[0]?.ok === true;

  it("an error in the middle rolls everything back", async () => {
    await expect(
      asAdministrator.unsafe(`${renderPgbossGrantsScript()}\nSELECT 1/0;`),
    ).rejects.toThrow(/division by zero/);
    expect(await can("pgboss.job", "SELECT")).toBe(false);
    expect(await can("pgboss.job", "INSERT")).toBe(false);
  });

  it("applied whole it gives the worker DML on the queue tables, and only SELECT + UPDATE on the version row", async () => {
    await asAdministrator.unsafe(renderPgbossGrantsScript());
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(await can("pgboss.job", privilege), privilege).toBe(true);
    }
    for (const privilege of ["SELECT", "UPDATE"]) {
      expect(await can("pgboss.version", privilege), privilege).toBe(true);
    }
    for (const privilege of ["INSERT", "DELETE", "TRUNCATE"]) {
      expect(await can("pgboss.version", privilege), privilege).toBe(false);
    }
    expect(await can("pgboss.job", "TRUNCATE")).toBe(false);
    const [app] = await admin<{ ok: boolean }[]>`
      SELECT has_schema_privilege(${APP_ROLE}, 'pgboss', 'USAGE') AS ok`;
    expect(app?.ok).toBe(false);
  });
});
