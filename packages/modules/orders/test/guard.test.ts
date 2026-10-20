// The database guard on orders (igs-pharma#116, D-045) on a database built the way production is: a
// non-superuser administrator owns the schema and the application connects as the unprivileged
// runtime role. Nothing here goes through a module command: these are the raw writes a careless or
// future writer could run.
import { randomUUID } from "node:crypto";

import { newId } from "@igs/db/ids";
import { type RuntimeRoleDatabase, createRuntimeRoleDatabase } from "@igs/db/testing";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ORDER_STATUSES, type OrderStatus, canTransition } from "../src";

let db: RuntimeRoleDatabase;
let app: postgres.Sql;
let admin: postgres.Sql;

beforeAll(async () => {
  db = await createRuntimeRoleDatabase();
  await db.migrate();
  app = postgres(db.appUrl, { max: 4, onnotice: () => {} });
  admin = postgres(db.adminUrl, { max: 2, onnotice: () => {} });
}, 180_000);
afterAll(async () => {
  await Promise.all([app?.end({ timeout: 5 }), admin?.end({ timeout: 5 })]);
  await db?.drop();
});

const failure = async (promise: PromiseLike<unknown>) => {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; message?: string };
    return { code: e.code, message: e.message };
  }
  return undefined;
};

let nextReference = 1;

interface Line {
  readonly isMedicine: boolean;
  readonly quantity?: number;
  readonly unitPriceCents?: number;
  readonly vatCents?: number;
}

/** Inserts an order and its lines in ONE transaction, the way checkout will (totals = sums). */
async function placeOrder(
  lines: readonly Line[] = [{ isMedicine: false }],
  options: { totalCents?: number } = {},
): Promise<string> {
  const id = newId();
  const rows = lines.map((line) => {
    const quantity = line.quantity ?? 1;
    const unitPriceCents = line.unitPriceCents ?? 499;
    return {
      quantity,
      unitPriceCents,
      lineTotalCents: quantity * unitPriceCents,
      vatCents: line.vatCents ?? 28,
      isMedicine: line.isMedicine,
    };
  });
  const total = options.totalCents ?? rows.reduce((sum, row) => sum + row.lineTotalCents, 0);
  const vat = rows.reduce((sum, row) => sum + row.vatCents, 0);
  const reference = `IGS-2026-${String(nextReference++).padStart(6, "0")}`;
  await app.begin(async (sql) => {
    await sql`
      INSERT INTO orders.orders (id, reference, locale, needs_review, total_cents, vat_cents,
        created_by_type, created_by_id, updated_by_type, updated_by_id)
      VALUES (${id}, ${reference}, 'nl', ${rows.some((row) => row.isMedicine)}, ${total}, ${vat},
        'anonymous', 'guest', 'anonymous', 'guest')`;
    let cnk = 1_000_000;
    for (const row of rows) {
      await sql`
        INSERT INTO orders.order_lines (id, order_id, product_id, cnk, name, is_medicine, vat_class,
          quantity, unit_price_cents, line_total_cents, vat_cents)
        VALUES (${newId()}, ${id}, ${randomUUID()}, ${String(cnk++)}, 'Demo', ${row.isMedicine}, 'BE_6',
          ${row.quantity}, ${row.unitPriceCents}, ${row.lineTotalCents}, ${row.vatCents})`;
    }
  });
  return id;
}

const statusOf = async (id: string) =>
  (
    await admin<{ status: string; version: number }[]>`
    SELECT status, version FROM orders.orders WHERE id = ${id}`
  )[0];

/** A raw status change, bumping the version as every writer must. */
const move = (id: string, to: OrderStatus, actor = "staff-1") =>
  app`
    UPDATE orders.orders SET status = ${to}, version = version + 1,
      updated_by_type = 'user', updated_by_id = ${actor}, updated_at = now()
    WHERE id = ${id}`;

/** The shortest legal path from `pending_payment` to `status` for an order without a medicine. */
const PATH: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: [],
  paid_stock_short: ["paid_stock_short"],
  in_review: ["in_review"],
  ready_to_prepare: ["ready_to_prepare"],
  preparing: ["ready_to_prepare", "preparing"],
  ready_for_pickup: ["ready_to_prepare", "preparing", "ready_for_pickup"],
  collected: ["ready_to_prepare", "preparing", "ready_for_pickup", "collected"],
  cancelled: ["cancelled"],
  expired: ["expired"],
};

async function orderAt(status: OrderStatus, lines?: readonly Line[]): Promise<string> {
  const id = await placeOrder(lines);
  for (const step of PATH[status]) await move(id, step);
  return id;
}

describe("the order lifecycle", () => {
  it("allows exactly the transitions of ORDER_TRANSITIONS, for every pair (no medicine)", async () => {
    const mismatches: string[] = [];
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        if (from === to) continue;
        const id = await orderAt(from);
        const refused = await failure(move(id, to));
        const allowed = canTransition(from, to, { needsReview: false });
        if (allowed === (refused !== undefined)) mismatches.push(`${from} → ${to}`);
        if (refused) expect(refused.code).toBe("23000");
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("an order holding a medicine is prepared only after in_review", async () => {
    const medicine = [{ isMedicine: true }];
    const direct = await placeOrder(medicine);
    expect(canTransition("pending_payment", "ready_to_prepare", { needsReview: true })).toBe(false);
    expect((await failure(move(direct, "ready_to_prepare")))?.message).toMatch(/pharmacist/);

    const short = await placeOrder(medicine);
    await move(short, "paid_stock_short");
    expect((await failure(move(short, "ready_to_prepare")))?.message).toMatch(/pharmacist/);

    const reviewed = await placeOrder(medicine);
    await move(reviewed, "in_review");
    await move(reviewed, "ready_to_prepare", "pharmacist-1");
    expect(await statusOf(reviewed)).toEqual({ status: "ready_to_prepare", version: 3 });
  });

  it("a new order starts in pending_payment at version 1", async () => {
    const id = newId();
    const refused = await failure(
      app.begin(
        (sql) => sql`
          INSERT INTO orders.orders (id, reference, locale, status, needs_review, total_cents, vat_cents,
            created_by_type, created_by_id, updated_by_type, updated_by_id)
          VALUES (${id}, 'IGS-2026-999999', 'nl', 'ready_to_prepare', false, 0, 0, 'user', 'x', 'user', 'x')`,
      ),
    );
    expect(refused?.message).toMatch(/starts in pending_payment/);
  });

  it("every update bumps the version by exactly one", async () => {
    const id = await placeOrder();
    const stale = await failure(
      app`UPDATE orders.orders SET status = 'cancelled' WHERE id = ${id}`,
    );
    expect(stale?.message).toMatch(/version/);
    const skipped = await failure(
      app`UPDATE orders.orders SET status = 'cancelled', version = version + 2 WHERE id = ${id}`,
    );
    expect(skipped?.message).toMatch(/version/);
    expect(await statusOf(id)).toEqual({ status: "pending_payment", version: 1 });
  });

  it("keeps the reference, customer, totals and review flag", async () => {
    const id = await placeOrder();
    for (const change of [
      app`UPDATE orders.orders SET reference = 'IGS-2026-123456', version = version + 1 WHERE id = ${id}`,
      app`UPDATE orders.orders SET customer_id = ${randomUUID()}, version = version + 1 WHERE id = ${id}`,
      app`UPDATE orders.orders SET total_cents = 1, version = version + 1 WHERE id = ${id}`,
      app`UPDATE orders.orders SET needs_review = true, version = version + 1 WHERE id = ${id}`,
    ]) {
      expect((await failure(change))?.message).toMatch(/keeps its reference/);
    }
  });

  it("an order in an end state never changes again", async () => {
    for (const end of ["collected", "cancelled", "expired"] as const) {
      const id = await orderAt(end);
      const touched = await failure(
        app`UPDATE orders.orders SET updated_by_id = 'x', version = version + 1 WHERE id = ${id}`,
      );
      expect(touched?.message).toMatch(/cannot change/);
    }
  });
});

describe("lines and totals", () => {
  it("an order without lines is refused at commit", async () => {
    const refused = await failure(
      app.begin(
        (sql) => sql`
          INSERT INTO orders.orders (id, reference, locale, needs_review, total_cents, vat_cents,
            created_by_type, created_by_id, updated_by_type, updated_by_id)
          VALUES (${newId()}, 'IGS-2026-900001', 'nl', false, 0, 0, 'user', 'x', 'user', 'x')`,
      ),
    );
    expect(refused?.message).toMatch(/does not match its lines/);
  });

  it("totals that are not the sum of the lines are refused, and so is a wrong review flag", async () => {
    expect(
      (await failure(placeOrder([{ isMedicine: false }], { totalCents: 500 })))?.message,
    ).toMatch(/does not match its lines/);
    // needs_review is computed from the lines in placeOrder; lie about it directly
    const id = newId();
    const lying = await failure(
      app.begin(async (sql) => {
        await sql`
          INSERT INTO orders.orders (id, reference, locale, needs_review, total_cents, vat_cents,
            created_by_type, created_by_id, updated_by_type, updated_by_id)
          VALUES (${id}, 'IGS-2026-900002', 'nl', false, 499, 28, 'user', 'x', 'user', 'x')`;
        await sql`
          INSERT INTO orders.order_lines (id, order_id, product_id, cnk, name, is_medicine, vat_class,
            quantity, unit_price_cents, line_total_cents, vat_cents)
          VALUES (${newId()}, ${id}, ${randomUUID()}, '1000000', 'Demo', true, 'BE_6', 1, 499, 499, 28)`;
      }),
    );
    expect(lying?.message).toMatch(/does not match its lines/);
  });

  it("a line added later is refused: after payment by the guard, before it by the totals", async () => {
    const addLine = (orderId: string) =>
      app.begin(
        (sql) => sql`
          INSERT INTO orders.order_lines (id, order_id, product_id, cnk, name, is_medicine, vat_class,
            quantity, unit_price_cents, line_total_cents, vat_cents)
          VALUES (${newId()}, ${orderId}, ${randomUUID()}, '2000000', 'Late', false, 'BE_21', 1, 100, 100, 17)`,
      );
    const pending = await placeOrder();
    expect((await failure(addLine(pending)))?.message).toMatch(/does not match its lines/);
    const paid = await orderAt("ready_to_prepare");
    expect((await failure(addLine(paid)))?.message).toMatch(/only while it is pending_payment/);
  });

  it("lines are never changed or deleted, and orders are never deleted", async () => {
    const id = await placeOrder();
    expect(
      (await failure(app`UPDATE orders.order_lines SET quantity = 2 WHERE order_id = ${id}`))?.code,
    ).toBe("42501");
    expect((await failure(app`DELETE FROM orders.order_lines WHERE order_id = ${id}`))?.code).toBe(
      "42501",
    );
    // the runtime role has no DELETE on orders; the trigger refuses even the administrator
    expect((await failure(app`DELETE FROM orders.orders WHERE id = ${id}`))?.code).toBe("42501");
    expect((await failure(admin`DELETE FROM orders.orders WHERE id = ${id}`))?.message).toMatch(
      /orders are kept/,
    );
    expect((await failure(admin`TRUNCATE orders.order_lines CASCADE`))?.message).toMatch(
      /orders are kept/,
    );
  });
});

describe("the status history", () => {
  it("records the creation and every status change, with who changed it", async () => {
    const id = await placeOrder();
    await move(id, "ready_to_prepare", "staff-a");
    await app`
      UPDATE orders.orders SET version = version + 1, updated_by_id = 'staff-b' WHERE id = ${id}`;
    await move(id, "preparing", "staff-c");
    const events = await app<
      { from_status: string | null; to_status: string; actor_id: string; id: string }[]
    >`SELECT id, from_status, to_status, actor_id FROM orders.order_events WHERE order_id = ${id} ORDER BY at, id`;
    expect(events.map(({ id: _id, ...rest }) => rest)).toEqual([
      { from_status: null, to_status: "pending_payment", actor_id: "guest" },
      { from_status: "pending_payment", to_status: "ready_to_prepare", actor_id: "staff-a" },
      // an update that keeps the status writes no event
      { from_status: "ready_to_prepare", to_status: "preparing", actor_id: "staff-c" },
    ]);
    // the ids are UUIDv7 (D-003)
    for (const event of events)
      expect(event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab]/);
  });

  it("the runtime role cannot write the history itself, and nobody can change it", async () => {
    const id = await placeOrder();
    const forged = await failure(
      app`
        INSERT INTO orders.order_events (id, order_id, to_status, actor_type, actor_id, at)
        VALUES (${newId()}, ${id}, 'collected', 'user', 'x', now())`,
    );
    expect(forged?.code).toBe("42501");
    expect(
      (await failure(admin`UPDATE orders.order_events SET actor_id = 'x' WHERE order_id = ${id}`))
        ?.message,
    ).toMatch(/orders are kept/);
  });
});
