// The database guard against overselling (igs-pharma#83, D7/D-037) on a database built the way
// production is: a non-superuser administrator owns the schemas and the application connects as an
// unprivileged login role. Nothing here goes through the module's writer.
import { randomUUID } from "node:crypto";

import { type RuntimeRoleDatabase, createRuntimeRoleDatabase } from "@igs/db/testing";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_LOCATION_ID } from "../src";

let db: RuntimeRoleDatabase;
let app: postgres.Sql;
let other: postgres.Sql;
let admin: postgres.Sql;

beforeAll(async () => {
  db = await createRuntimeRoleDatabase();
  await db.migrate();
  app = postgres(db.appUrl, { max: 4, onnotice: () => {} });
  other = postgres(db.appUrl, { max: 4, onnotice: () => {} });
  admin = postgres(db.adminUrl, { max: 2, onnotice: () => {} });
}, 180_000);
afterAll(async () => {
  await Promise.all([
    app?.end({ timeout: 5 }),
    other?.end({ timeout: 5 }),
    admin?.end({ timeout: 5 }),
  ]);
  await db?.drop();
});

/** A raw ledger insert, exactly what a careless writer would run: no lock, no module function. */
const rawMove = (sql: postgres.Sql | postgres.TransactionSql, productId: string, delta: number) =>
  sql`
    WITH made AS (
      INSERT INTO inventory.lots (id, product_id, location_id, tracking, created_by_type, created_by_id)
      VALUES (${randomUUID()}, ${productId}, ${DEFAULT_LOCATION_ID}, 'no_lot', 'system', 'test')
      ON CONFLICT DO NOTHING RETURNING id
    )
    INSERT INTO inventory.stock_movements (id, product_id, location_id, lot_id, delta, reason, actor_type, actor_id)
    VALUES (${randomUUID()}, ${productId}, ${DEFAULT_LOCATION_ID},
      coalesce((SELECT id FROM made), (SELECT id FROM inventory.lots
        WHERE product_id = ${productId} AND location_id = ${DEFAULT_LOCATION_ID} AND tracking = 'no_lot')),
      ${delta}, 'adjustment', 'system', 'test')`;

const failure = async (promise: PromiseLike<unknown>) => {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; constraint_name?: string; message?: string };
    return { code: e.code, constraint: e.constraint_name, message: e.message };
  }
  return undefined;
};

const levelOf = async (productId: string) =>
  (
    await admin<{ on_hand: number }[]>`
      SELECT on_hand FROM inventory.stock_levels WHERE product_id = ${productId}`
  )[0]?.on_hand;

describe("the database refuses negative stock", () => {
  it("a raw insert that would take a product below zero is rejected, with no lock and no function", async () => {
    const product = randomUUID();
    await rawMove(app, product, 3);
    expect(await levelOf(product)).toBe(3);
    expect(await failure(rawMove(app, product, -4))).toMatchObject({
      code: "23514",
      constraint: "stock_levels_on_hand_check",
    });
    // the refused movement left nothing behind
    expect(await levelOf(product)).toBe(3);
    const [sum] = await admin<{ total: number }[]>`
      SELECT sum(delta)::int AS total FROM inventory.stock_movements WHERE product_id = ${product}`;
    expect(sum?.total).toBe(3);
    // exactly down to zero is fine
    await rawMove(app, product, -3);
    expect(await levelOf(product)).toBe(0);
  });

  it("a first movement that is negative is rejected", async () => {
    const product = randomUUID();
    expect(await failure(rawMove(app, product, -1))).toMatchObject({ code: "23514" });
    expect(await levelOf(product)).toBeUndefined();
  });

  it("two raw transactions racing for the last unit: one wins, the other is rejected", async () => {
    for (let round = 0; round < 10; round++) {
      const product = randomUUID();
      await rawMove(app, product, 1);
      const attempt = (sql: postgres.Sql) =>
        failure(sql.begin(async (tx) => rawMove(tx, product, -1)));
      const outcomes = await Promise.all([attempt(app), attempt(other)]);
      expect(outcomes.filter((o) => o === undefined)).toHaveLength(1);
      expect(outcomes.filter((o) => o?.code === "23514")).toHaveLength(1);
      expect(await levelOf(product)).toBe(0);
    }
  });

  it("many raw writers: exactly as many succeed as there is stock", async () => {
    const product = randomUUID();
    await rawMove(app, product, 5);
    const outcomes = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        failure(rawMove(i % 2 === 0 ? app : other, product, -1)),
      ),
    );
    expect(outcomes.filter((o) => o === undefined)).toHaveLength(5);
    expect(outcomes.filter((o) => o?.code === "23514")).toHaveLength(11);
    expect(await levelOf(product)).toBe(0);
  });

  it("stock_levels equals the sum of the ledger after a mixed run", async () => {
    const products = [randomUUID(), randomUUID(), randomUUID()];
    for (const [i, product] of products.entries()) {
      await rawMove(app, product, 10 + i);
      await failure(rawMove(app, product, -50)); // refused, changes nothing
      await rawMove(app, product, -(i + 1));
      await rawMove(other, product, 4);
    }
    const mismatches = await admin<{ product_id: string }[]>`
      SELECT product_id FROM (
        SELECT product_id, location_id, sum(delta)::int AS total
        FROM inventory.stock_movements GROUP BY product_id, location_id) m
      FULL JOIN inventory.stock_levels l USING (product_id, location_id)
      WHERE m.total IS DISTINCT FROM l.on_hand`;
    expect(mismatches).toEqual([]);
  });
});

describe("nobody but the trigger writes the levels", () => {
  it("the application role can read stock_levels but not change it", async () => {
    const product = randomUUID();
    await rawMove(app, product, 2);
    expect(
      (await app`SELECT on_hand FROM inventory.stock_levels WHERE product_id = ${product}`)[0],
    ).toEqual({
      on_hand: 2,
    });
    for (const statement of [
      app`UPDATE inventory.stock_levels SET on_hand = 999 WHERE product_id = ${product}`,
      app`INSERT INTO inventory.stock_levels (product_id, location_id, on_hand) VALUES (${randomUUID()}, ${DEFAULT_LOCATION_ID}, 5)`,
      app`DELETE FROM inventory.stock_levels WHERE product_id = ${product}`,
    ]) {
      expect(await failure(statement)).toMatchObject({ code: "42501" });
    }
    expect(await levelOf(product)).toBe(2);
  });

  it("the trigger function is SECURITY DEFINER, pinned, and executable by nobody else", async () => {
    const [fn] = await admin<
      { definer: boolean; config: string[] | null; owner: string; public_exec: boolean }[]
    >`
      SELECT p.prosecdef AS definer, p.proconfig AS config, pg_get_userbyid(p.proowner) AS owner,
        has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
      FROM pg_proc p WHERE p.oid = 'inventory.apply_movement_to_level()'::regprocedure`;
    expect(fn).toMatchObject({ definer: true, owner: db.adminRole, public_exec: false });
    expect(fn?.config).toEqual(["search_path=pg_catalog, inventory, pg_temp"]);
    for (const role of [db.appRole, db.workerRole]) {
      const [row] = await admin<{ ok: boolean }[]>`
        SELECT has_function_privilege(${role}, 'inventory.apply_movement_to_level()', 'EXECUTE') AS ok`;
      expect(row?.ok).toBe(false);
    }
  });

  it("the ledger stays append-only", async () => {
    const product = randomUUID();
    await rawMove(app, product, 1);
    expect(
      await failure(
        app`UPDATE inventory.stock_movements SET delta = 5 WHERE product_id = ${product}`,
      ),
    ).toMatchObject({ code: "42501" });
    expect(
      await failure(
        admin`UPDATE inventory.stock_movements SET delta = 5 WHERE product_id = ${product}`,
      ),
    ).toMatchObject({ message: expect.stringMatching(/append-only/) });
  });
});
