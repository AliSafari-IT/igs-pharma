import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createIsolatedDatabase, getTestDatabase, withTestTx } from "../src/testing";

// packages/db owns no tables (D-017), so the harness is exercised with plain SQL against the
// kernel's `system.idempotency_keys` (reached by name — no import, `db ↛ kernel`).
const insertKey = (key: string, response?: string) =>
  sql`INSERT INTO system.idempotency_keys (key, expires_at, response)
      VALUES (${key}, now() + interval '1 minute', ${response ?? null})
      ON CONFLICT DO NOTHING RETURNING key`;

describe("idempotency_keys", () => {
  it("ON CONFLICT DO NOTHING keeps the first response", async () => {
    await withTestTx(async (tx) => {
      expect(await tx.execute(insertKey("k-1", "first"))).toHaveLength(1);
      expect(await tx.execute(insertKey("k-1", "second"))).toHaveLength(0);

      const rows = await tx.execute(
        sql`SELECT response FROM system.idempotency_keys WHERE key = 'k-1'`,
      );
      expect(rows[0]?.["response"]).toBe("first");
    });
  });
});

describe("withTestTx", () => {
  it("rolls back everything at the end of the test", async () => {
    await withTestTx(async (tx) => {
      await tx.execute(insertKey("k-rollback"));
    });
    const rows = await getTestDatabase().db.execute(
      sql`SELECT 1 FROM system.idempotency_keys WHERE key = 'k-rollback'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("returns the callback result and rethrows callback errors", async () => {
    expect(await withTestTx(async () => 42)).toBe(42);
    await expect(
      withTestTx(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});

describe("createIsolatedDatabase", () => {
  it("gives a migrated, independent database per call (DDL is safe)", async () => {
    const a = await createIsolatedDatabase();
    const b = await createIsolatedDatabase();
    try {
      await a.sql`CREATE TABLE only_in_a (id int)`;
      const [inA] = await a.sql`SELECT to_regclass('only_in_a') AS t`;
      const [inB] = await b.sql`SELECT to_regclass('only_in_a') AS t`;
      expect(inA?.["t"]).not.toBeNull();
      expect(inB?.["t"]).toBeNull();
      const [migrated] = await b.sql`SELECT to_regclass('identity.users') AS t`;
      expect(migrated?.["t"]).not.toBeNull();
    } finally {
      await a.drop();
      await b.drop();
    }
  });
});
