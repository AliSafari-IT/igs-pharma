import { afterAll, describe, expect, it } from "vitest";

import { type IsolatedDatabase, applyMigrations, createIsolatedDatabase } from "../src/testing";

describe("migrations", () => {
  let empty: IsolatedDatabase;

  afterAll(async () => {
    await empty?.drop();
  });

  it("apply cleanly from an empty database", async () => {
    empty = await createIsolatedDatabase({ migrated: false });
    await applyMigrations(empty.url);

    const tables = await empty.sql<{ table_schema: string; table_name: string }[]>`
      SELECT table_schema, table_name FROM information_schema.tables
      WHERE table_schema IN ('public', 'identity', 'system') ORDER BY 1, 2`;
    const names = tables.map((t) => `${t.table_schema}.${t.table_name}`);
    expect(names).toEqual(
      expect.arrayContaining([
        "system.idempotency_keys",
        "identity.users",
        "identity.sessions",
        "identity.accounts",
        "identity.verifications",
        "identity.two_factors",
        "identity.passkeys",
      ]),
    );

    const [ext] = await empty.sql`SELECT 1 AS ok FROM pg_extension WHERE extname = 'citext'`;
    expect(ext).toBeDefined();
  });

  it("idempotency_keys lives in the kernel's `system` schema only (D-017)", async () => {
    const rows = await empty.sql<{ table_schema: string }[]>`
      SELECT table_schema FROM information_schema.tables WHERE table_name = 'idempotency_keys'`;
    expect(rows.map((r) => r.table_schema)).toEqual(["system"]);
  });

  it("re-applying is a no-op", async () => {
    const count = async () => {
      const [row] = await empty.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
      return row?.n;
    };
    const before = await count();
    await applyMigrations(empty.url);
    expect(await count()).toBe(before);
  });

  it("identity.users.email is case-insensitively unique (citext)", async () => {
    await empty.sql`INSERT INTO identity.users (id, name, email)
      VALUES (gen_random_uuid(), 'A', 'Someone@Example.com')`;
    await expect(
      empty.sql`INSERT INTO identity.users (id, name, email)
        VALUES (gen_random_uuid(), 'B', 'someone@example.com')`,
    ).rejects.toThrow(/users_email_unique/);
  });
});
