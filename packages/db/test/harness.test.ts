import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { idempotencyKeys } from "../src/schema/index";
import { createIsolatedDatabase, getTestDatabase, withTestTx } from "../src/testing";

const expires = () => new Date(Date.now() + 60_000);

describe("idempotency_keys", () => {
  it("ON CONFLICT DO NOTHING keeps the first response", async () => {
    await withTestTx(async (tx) => {
      const insert = (response: string) =>
        tx
          .insert(idempotencyKeys)
          .values({ key: "k-1", expiresAt: expires(), response })
          .onConflictDoNothing()
          .returning({ key: idempotencyKeys.key });

      expect(await insert("first")).toHaveLength(1);
      expect(await insert("second")).toHaveLength(0);

      const [row] = await tx.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, "k-1"));
      expect(row?.response).toBe("first");
    });
  });
});

describe("withTestTx", () => {
  it("rolls back everything at the end of the test", async () => {
    await withTestTx(async (tx) => {
      await tx.insert(idempotencyKeys).values({ key: "k-rollback", expiresAt: expires() });
    });
    const rows = await getTestDatabase().db.execute(
      sql`SELECT 1 FROM idempotency_keys WHERE key = 'k-rollback'`,
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
