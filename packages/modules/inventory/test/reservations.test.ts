// Stock reservations (igs-pharma#99) against real Postgres, with the RBAC catalogue loaded from the
// database and the real audit port: the lifecycle, the last-box race, the expiry boundary to the
// millisecond, orders that never expire, consuming into the ledger, shortness, and who may call what.
import { randomUUID } from "node:crypto";

import { newId } from "@igs/db/ids";
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { type Actor, isDomainError } from "@igs/kernel";
import { type KernelTestHandles, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import {
  createProductRegulated,
  registerAuditActions as registerCatalogAudit,
  setProductStatusRegulated,
} from "@igs/module-catalog";
import { loadRbacCatalogue } from "@igs/module-identity";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  HOLD_DEFAULT_MINUTES,
  adjustStock,
  confirmReservation,
  consumeReservation,
  expireReservations,
  getAvailability,
  getStock,
  importStock,
  listStock,
  prepareStockImport,
  registerAuditActions,
  releaseReservation,
  releaseReservationByStaff,
  reserveStock,
  runReservationExpiry,
} from "../src";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;
let t0: Date;

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  registerCatalogAudit(registerAuditAction);
  registerAuditActions(registerAuditAction);
});
afterAll(async () => {
  await iso?.drop();
});
beforeEach(async () => {
  kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  t0 = new Date();
  kernel.clock.set(t0); // audit partitions exist around "now"
  // every test starts with nothing reserved: reservations are kept, so the earlier ones are ended
  await iso.sql`
    UPDATE inventory.reservations SET status = 'released', release_reason = 'staff_correction'
    WHERE status = 'active'`;
});

const MINUTE = 60_000;
const DAY = 86_400_000;
const at = (ms: number) => new Date(t0.getTime() + ms);

const staff = (...roles: string[]): Actor => ({
  type: "user",
  id: randomUUID(),
  roles,
  kind: "staff",
  mfaVerified: true,
});
const owner = staff("owner");
const pharmacist = staff("pharmacist");
const assistant = staff("pharmacy_assistant");
/** The future checkout and the expiry job. */
const checkout: Actor = { type: "system", id: "checkout", roles: ["system_reservations"] };
const storefront: Actor = { type: "system", id: "storefront", roles: ["system_storefront"] };

let nextCnk = 9_900_100;

/** An ACTIVE catalog product, so the storefront knows it. */
async function product(): Promise<string> {
  const cnk = String(nextCnk++);
  const { productId } = await createProductRegulated(
    {
      cnk,
      productType: "otc_medicine",
      legalStatus: "otc",
      vatClass: "BE_6",
      content: [
        { locale: "nl", name: `Demo ${cnk}` },
        { locale: "fr", name: `Demo ${cnk} FR` },
      ],
    },
    pharmacist,
  );
  await setProductStatusRegulated({ productId, status: "active" }, pharmacist);
  return productId;
}

/** A product with `onHand` units on the shelf. */
async function stocked(onHand: number): Promise<string> {
  const productId = await product();
  if (onHand > 0) {
    await adjustStock({ productId, delta: onHand, reason: "adjustment", note: "seed" }, owner);
  }
  return productId;
}

const holder = () => `checkout:${newId()}`;

/**
 * Confirms the way the checkout does, with the basket it expects: here, exactly what the holder has
 * active right now (read from the table). The tests of the expected set pass `items` themselves.
 */
async function confirm(holderRef: string, actor: Actor = checkout) {
  const items = await iso.sql<{ productId: string; quantity: number }[]>`
    SELECT product_id AS "productId", quantity FROM inventory.reservations
    WHERE holder_ref = ${holderRef} AND status = 'active' ORDER BY product_id`;
  return confirmReservation({ holderRef, items: items.map((i) => ({ ...i })) }, actor);
}

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "ok";
};

const rowsOf = (productId: string) =>
  iso.sql<
    {
      id: string;
      kind: string;
      status: string;
      quantity: number;
      holder_ref: string;
      expires_at: Date | null;
      release_reason: string | null;
    }[]
  >`SELECT id, kind, status, quantity, holder_ref, expires_at, release_reason
    FROM inventory.reservations WHERE product_id = ${productId} ORDER BY created_at, id`;

const stockOf = async (productId: string) => {
  const stock = await getStock({ productId }, owner);
  return stock;
};

describe("reserveStock", () => {
  it("sets a hold aside for 15 minutes by default; on hand is untouched, available shrinks", async () => {
    const productId = await stocked(10);
    const holderRef = holder();
    const result = await reserveStock({ productId, quantity: 4, holderRef }, checkout);
    expect(result).toMatchObject({ kind: "hold", quantity: 4, created: true });
    expect(result.expiresAt?.getTime()).toBe(at(HOLD_DEFAULT_MINUTES * MINUTE).getTime());
    const stock = await stockOf(productId);
    expect([stock.onHand, stock.held, stock.available, stock.short]).toEqual([10, 4, 6, 0]);
  });

  it("takes a hold of up to 30 minutes and refuses longer or non-sense input", async () => {
    const productId = await stocked(10);
    const long = await reserveStock(
      { productId, quantity: 1, holderRef: holder(), holdMinutes: 30 },
      checkout,
    );
    expect(long.expiresAt?.getTime()).toBe(at(30 * MINUTE).getTime());
    for (const input of [
      { holdMinutes: 31 },
      { holdMinutes: 0 },
      { quantity: 0 },
      { holderRef: "someone@example.com" },
      { holderRef: "has space" },
      { holderRef: "" },
      // only checkout:<uuidv7> and order:<uuidv7> (#101 review): no names, no national numbers
      { holderRef: "jan.peeters" },
      { holderRef: "85073003328" },
      { holderRef: "checkout:jan.peeters" },
      { holderRef: `basket:${newId()}` },
      { holderRef: `checkout:${randomUUID()}` }, // a v4 uuid
      { holderRef: `checkout:${newId()}x` },
    ]) {
      expect(
        await codeOf(
          reserveStock({ productId, quantity: 1, holderRef: holder(), ...input }, checkout),
        ),
        JSON.stringify(input),
      ).toBe("kernel.validation_failed");
    }
  });

  it("refuses with a typed error when less is available, and says how much", async () => {
    const productId = await stocked(3);
    await reserveStock({ productId, quantity: 2, holderRef: holder() }, checkout);
    await expect(
      reserveStock({ productId, quantity: 2, holderRef: holder() }, checkout),
    ).rejects.toMatchObject({ code: "inventory.insufficient_stock", details: { available: 1 } });
    // a product that never had stock has none to reserve either
    const empty = await product();
    expect(
      await codeOf(reserveStock({ productId: empty, quantity: 1, holderRef: holder() }, checkout)),
    ).toBe("inventory.insufficient_stock");
    expect(
      await codeOf(
        reserveStock({ productId: randomUUID(), quantity: 1, holderRef: holder() }, checkout),
      ),
    ).toBe("inventory.product_not_found");
  });

  it("20 parallel reservations for the last 5 units: exactly 5 succeed, the rest are typed refusals", async () => {
    const productId = await stocked(5);
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        reserveStock({ productId, quantity: 1, holderRef: holder() }, checkout).then(
          () => "ok",
          (error: unknown) => (isDomainError(error) ? error.code : `RAW: ${String(error)}`),
        ),
      ),
    );
    expect(results.filter((r) => r === "ok")).toHaveLength(5);
    expect(results.filter((r) => r === "inventory.insufficient_stock")).toHaveLength(15);
    expect(results.filter((r) => r.startsWith("RAW"))).toEqual([]);
    const stock = await stockOf(productId);
    expect([stock.held, stock.available]).toEqual([5, 0]);
  });

  it("takes the stock lock BEFORE it reads what is available: it waits for a movement in flight", async () => {
    const productId = await stocked(5);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inserted: () => void = () => {};
    const movementIn = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    // an uncommitted movement of -3 (its trigger holds the stock-level row lock)
    const open = iso.sql.begin(async (sql) => {
      await sql`
        INSERT INTO inventory.stock_movements (id, product_id, location_id, delta, reason, actor_type, actor_id)
        VALUES (gen_random_uuid(), ${productId}, '0192f000-0000-7000-8000-000000000001', -3, 'adjustment', 'system', 'raw')`;
      inserted();
      await gate;
    });
    await movementIn;
    let settled = false;
    const reserving = reserveStock({ productId, quantity: 5, holderRef: holder() }, checkout).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    void reserving.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(settled, "the reservation must wait for the movement in flight").toBe(false);
    release();
    await open;
    const outcome = await reserving;
    // it read 2 on hand, not the 5 it would have seen without the lock
    expect(isDomainError((outcome as { error?: unknown }).error)).toBe(true);
    expect(
      (outcome as { error: { code: string; details: { available: number } } }).error,
    ).toMatchObject({
      code: "inventory.insufficient_stock",
      details: { available: 2 },
    });
  });
});

describe("retries", () => {
  it("reserving again for the same holder returns the hold it has: no double reservation", async () => {
    const productId = await stocked(10);
    const holderRef = holder();
    const first = await reserveStock({ productId, quantity: 3, holderRef }, checkout);
    kernel.clock.advance(MINUTE);
    const second = await reserveStock({ productId, quantity: 3, holderRef }, checkout);
    expect(second).toMatchObject({ reservationId: first.reservationId, created: false });
    expect(second.expiresAt?.getTime()).toBe(first.expiresAt?.getTime()); // the clock does not restart
    expect(await rowsOf(productId)).toHaveLength(1);
    expect((await stockOf(productId)).held).toBe(3);
  });

  it("asking again with a different quantity is refused with the quantity held, and changes nothing", async () => {
    const productId = await stocked(10);
    const holderRef = holder();
    await reserveStock({ productId, quantity: 3, holderRef }, checkout);
    for (const quantity of [2, 4]) {
      await expect(reserveStock({ productId, quantity, holderRef }, checkout)).rejects.toMatchObject({
        code: "inventory.reservation_quantity_mismatch",
        details: { held: 3 },
      });
    }
    expect(await rowsOf(productId)).toHaveLength(1);
    expect((await stockOf(productId)).held).toBe(3);
  });

  it("the same idempotency key replays; with other input it is refused", async () => {
    const productId = await stocked(10);
    const holderRef = holder();
    const key = { idempotencyKey: `reserve:${randomUUID()}` };
    const first = await reserveStock({ productId, quantity: 2, holderRef }, checkout, key);
    const replay = await reserveStock({ productId, quantity: 2, holderRef }, checkout, key);
    expect(replay.reservationId).toBe(first.reservationId);
    expect(await codeOf(reserveStock({ productId, quantity: 3, holderRef }, checkout, key))).toBe(
      "kernel.idempotency_key_reused",
    );
    expect(await rowsOf(productId)).toHaveLength(1);
  });

  it("confirming twice changes nothing the second time", async () => {
    const productId = await stocked(10);
    const holderRef = holder();
    await reserveStock({ productId, quantity: 2, holderRef }, checkout);
    await confirm(holderRef, checkout);
    const before = await rowsOf(productId);
    kernel.clock.advance(5 * MINUTE);
    const again = await confirm(holderRef, checkout);
    expect(again.reservations).toHaveLength(1);
    expect(await rowsOf(productId)).toEqual(before);
    const [row] = await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit.events WHERE action = 'inventory.reservation.confirmed' AND entity_id = ${productId}`;
    expect(row?.n).toBe(1);
  });

  it("releasing a holder with nothing active is harmless", async () => {
    const holderRef = holder();
    expect(await releaseReservation({ holderRef, reason: "checkout_cancelled" }, checkout)).toEqual(
      {
        holderRef,
        released: 0,
      },
    );
  });
});

describe("the expiry boundary", () => {
  it("a hold counts until expires_at exactly: 1 ms before it still holds, at it the stock is free", async () => {
    const productId = await stocked(5);
    await reserveStock({ productId, quantity: 5, holderRef: holder() }, checkout);
    kernel.clock.set(at(15 * MINUTE - 1));
    expect((await stockOf(productId)).available).toBe(0);
    expect(
      await codeOf(reserveStock({ productId, quantity: 1, holderRef: holder() }, checkout)),
    ).toBe("inventory.insufficient_stock");
    kernel.clock.set(at(15 * MINUTE));
    // the job has not run: the row is still `active`, but it no longer takes any stock
    expect((await rowsOf(productId))[0]?.status).toBe("active");
    expect((await stockOf(productId)).available).toBe(5);
    expect(
      await codeOf(reserveStock({ productId, quantity: 5, holderRef: holder() }, checkout)),
    ).toBe("ok");
  });

  it("the expiry job marks lapsed holds exactly at expires_at, audits them, and is safe to run twice", async () => {
    const productId = await stocked(5);
    const holderRef = holder();
    const { reservationId } = await reserveStock({ productId, quantity: 2, holderRef }, checkout);
    kernel.clock.set(at(15 * MINUTE - 1));
    expect(await expireReservations({}, checkout)).toEqual({ expired: 0 });
    kernel.clock.set(at(15 * MINUTE));
    expect(await runReservationExpiry()).toBe(1);
    expect(await runReservationExpiry()).toBe(0);
    expect((await rowsOf(productId))[0]?.status).toBe("expired");
    const events = await iso.sql<{ action: string; data: Record<string, unknown> }[]>`
      SELECT action, data FROM audit.events WHERE entity_id = ${productId} AND action = 'inventory.reservation.expired'`;
    expect(events).toEqual([
      {
        action: "inventory.reservation.expired",
        data: { reservationId, productId, quantity: 2 },
      },
    ]);
  });

  it("two expiry runs at the same time mark each hold once", async () => {
    const productId = await stocked(50);
    for (let i = 0; i < 10; i += 1) {
      await reserveStock({ productId, quantity: 1, holderRef: holder() }, checkout);
    }
    kernel.clock.set(at(20 * MINUTE));
    const counts = await Promise.all([
      expireReservations({}, checkout),
      expireReservations({}, checkout),
    ]);
    expect(counts.reduce((sum, c) => sum + c.expired, 0)).toBe(10);
    const [row] = await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit.events WHERE entity_id = ${productId} AND action = 'inventory.reservation.expired'`;
    expect(row?.n).toBe(10);
  });

  it("an order never expires, not even days later, and the job leaves it alone", async () => {
    const productId = await stocked(5);
    const holderRef = holder();
    await reserveStock({ productId, quantity: 3, holderRef }, checkout);
    await confirm(holderRef, checkout);
    kernel.clock.set(at(10 * DAY));
    expect(await runReservationExpiry()).toBe(0);
    const [row] = await rowsOf(productId);
    expect(row).toMatchObject({ kind: "order", status: "active", expires_at: null });
    const stock = await stockOf(productId);
    expect([stock.ordered, stock.available]).toEqual([3, 2]);
  });

  it("reserving again over a lapsed hold the job has not marked yet replaces it", async () => {
    const productId = await stocked(5);
    const holderRef = holder();
    const first = await reserveStock({ productId, quantity: 5, holderRef }, checkout);
    kernel.clock.set(at(16 * MINUTE));
    const second = await reserveStock({ productId, quantity: 5, holderRef }, checkout);
    expect(second.reservationId).not.toBe(first.reservationId);
    expect((await rowsOf(productId)).map((r) => r.status)).toEqual(["expired", "active"]);
  });
});

describe("confirmReservation", () => {
  it("a hold confirmed 1 ms before it expires survives and never expires: the clock is cleared", async () => {
    const productId = await stocked(5);
    const holderRef = holder();
    await reserveStock({ productId, quantity: 2, holderRef }, checkout);
    kernel.clock.set(at(15 * MINUTE - 1));
    const result = await confirm(holderRef, checkout);
    expect(result.reservations).toHaveLength(1);
    expect((await rowsOf(productId))[0]).toMatchObject({
      kind: "order",
      status: "active",
      expires_at: null,
    });
    kernel.clock.set(at(30 * MINUTE));
    expect(await runReservationExpiry()).toBe(0);
    expect((await stockOf(productId)).ordered).toBe(2);
  });

  it("a hold confirmed at or after its expiry is refused, and stays a hold", async () => {
    const productId = await stocked(5);
    const holderRef = holder();
    await reserveStock({ productId, quantity: 2, holderRef }, checkout);
    kernel.clock.set(at(15 * MINUTE));
    expect(await codeOf(confirm(holderRef, checkout))).toBe(
      "inventory.reservation_expired",
    );
    expect((await rowsOf(productId))[0]?.kind).toBe("hold");
    // after the job has marked it, the answer is the same
    await runReservationExpiry();
    expect(await codeOf(confirm(holderRef, checkout))).toBe(
      "inventory.reservation_expired",
    );
    expect(
      await codeOf(
        confirmReservation(
          { holderRef: holder(), items: [{ productId, quantity: 2 }] },
          checkout,
        ),
      ),
    ).toBe("inventory.reservation_not_found");
  });

  it("confirms every hold of the holder or none: one lapsed hold refuses the lot", async () => {
    const a = await stocked(5);
    const b = await stocked(5);
    const holderRef = holder();
    await reserveStock({ productId: a, quantity: 1, holderRef }, checkout);
    kernel.clock.advance(10 * MINUTE);
    await reserveStock({ productId: b, quantity: 1, holderRef }, checkout);
    kernel.clock.advance(6 * MINUTE); // a's hold (15 min) has lapsed, b's has not
    expect(await codeOf(confirm(holderRef, checkout))).toBe(
      "inventory.reservation_expired",
    );
    expect((await rowsOf(b))[0]?.kind).toBe("hold");
  });

  /** A basket of two lines, A reserved 10 minutes before B; 16 minutes in, A has lapsed and B has not. */
  async function basketWithLapsedLine() {
    const a = await stocked(5);
    const b = await stocked(5);
    const holderRef = holder();
    await reserveStock({ productId: a, quantity: 1, holderRef }, checkout);
    kernel.clock.advance(10 * MINUTE);
    await reserveStock({ productId: b, quantity: 2, holderRef }, checkout);
    kernel.clock.advance(6 * MINUTE);
    const items = [
      { productId: a, quantity: 1 },
      { productId: b, quantity: 2 },
    ];
    return { a, b, holderRef, items };
  }

  it("the answer does not depend on the expiry job: after it ran on part of the basket, confirm is still refused (#101 review)", async () => {
    const { a, b, holderRef, items } = await basketWithLapsedLine();
    // before the job: refused
    expect(await codeOf(confirmReservation({ holderRef, items }, checkout))).toBe(
      "inventory.reservation_expired",
    );
    // the job marks A expired; B is live
    expect(await runReservationExpiry()).toBe(1);
    expect((await rowsOf(a))[0]?.status).toBe("expired");
    expect(await codeOf(confirmReservation({ holderRef, items }, checkout))).toBe(
      "inventory.reservation_expired",
    );
    // nothing became an order, and B is still a hold
    expect((await rowsOf(b))[0]).toMatchObject({ kind: "hold", status: "active" });
    expect((await rowsOf(a)).every((r) => r.kind === "hold")).toBe(true);
  });

  it("the expiry job running at the same time as confirm never lets half a basket through", async () => {
    for (let round = 0; round < 5; round++) {
      const { b, holderRef, items } = await basketWithLapsedLine();
      const [confirmed] = await Promise.allSettled([
        confirmReservation({ holderRef, items }, checkout),
        runReservationExpiry(),
      ]);
      expect(confirmed.status).toBe("rejected");
      expect(
        confirmed.status === "rejected" && isDomainError(confirmed.reason)
          ? confirmed.reason.code
          : "ok",
      ).toBe("inventory.reservation_expired");
      expect((await rowsOf(b))[0]?.kind).toBe("hold");
    }
  });

  it("goes through only for exactly the expected basket: other lines or other quantities are refused", async () => {
    const a = await stocked(5);
    const b = await stocked(5);
    const holderRef = holder();
    await reserveStock({ productId: a, quantity: 2, holderRef }, checkout);
    await reserveStock({ productId: b, quantity: 1, holderRef }, checkout);
    const mismatch = "inventory.reservation_mismatch";
    // a line the holder does not have
    expect(
      await codeOf(
        confirmReservation({ holderRef, items: [{ productId: randomUUID(), quantity: 1 }] }, checkout),
      ),
    ).toBe(mismatch);
    // a different quantity
    expect(
      await codeOf(
        confirmReservation(
          {
            holderRef,
            items: [
              { productId: a, quantity: 3 },
              { productId: b, quantity: 1 },
            ],
          },
          checkout,
        ),
      ),
    ).toBe(mismatch);
    // the holder has MORE than the basket
    expect(
      await codeOf(confirmReservation({ holderRef, items: [{ productId: a, quantity: 2 }] }, checkout)),
    ).toBe(mismatch);
    expect((await rowsOf(a))[0]?.kind).toBe("hold");
    expect((await rowsOf(b))[0]?.kind).toBe("hold");
    // exactly the basket: both become orders
    const ok = await confirmReservation(
      {
        holderRef,
        items: [
          { productId: b, quantity: 1 },
          { productId: a, quantity: 2 },
        ],
      },
      checkout,
    );
    expect(ok.reservations).toHaveLength(2);
    // a basket without items, or with a product twice, is not valid input
    for (const items of [[], [{ productId: a, quantity: 1 }, { productId: a, quantity: 1 }]]) {
      expect(await codeOf(confirmReservation({ holderRef, items }, checkout))).toBe(
        "kernel.validation_failed",
      );
    }
  });
});

describe("releaseReservation", () => {
  it("a cancelled checkout puts the stock back, with a reason, audited with ids and a quantity only", async () => {
    const productId = await stocked(5);
    const holderRef = holder();
    const { reservationId } = await reserveStock({ productId, quantity: 4, holderRef }, checkout);
    expect(await releaseReservation({ holderRef, reason: "checkout_cancelled" }, checkout)).toEqual(
      {
        holderRef,
        released: 1,
      },
    );
    expect((await rowsOf(productId))[0]).toMatchObject({
      status: "released",
      release_reason: "checkout_cancelled",
    });
    expect((await stockOf(productId)).available).toBe(5);
    const [event] = await iso.sql<{ data: Record<string, unknown> }[]>`
      SELECT data FROM audit.events WHERE entity_id = ${productId} AND action = 'inventory.reservation.released'`;
    expect(event?.data).toEqual({
      reservationId,
      productId,
      quantity: 4,
      reason: "checkout_cancelled",
    });
    expect(JSON.stringify(event)).not.toContain(holderRef);
  });

  it("an order can be released too (a refund before picking)", async () => {
    const productId = await stocked(5);
    const holderRef = holder();
    await reserveStock({ productId, quantity: 2, holderRef }, checkout);
    await confirm(holderRef, checkout);
    await releaseReservation({ holderRef, reason: "refunded" }, checkout);
    expect((await stockOf(productId)).ordered).toBe(0);
  });

  it("staff release one reservation with a reason; an unknown or ended one is refused", async () => {
    const productId = await stocked(5);
    const { reservationId } = await reserveStock(
      { productId, quantity: 2, holderRef: holder() },
      checkout,
    );
    await releaseReservationByStaff({ reservationId, reason: "staff_correction" }, assistant);
    expect((await rowsOf(productId))[0]).toMatchObject({
      status: "released",
      release_reason: "staff_correction",
    });
    expect(
      await codeOf(
        releaseReservationByStaff({ reservationId, reason: "staff_correction" }, assistant),
      ),
    ).toBe("inventory.reservation_not_active");
    expect(
      await codeOf(
        releaseReservationByStaff(
          { reservationId: randomUUID(), reason: "staff_correction" },
          assistant,
        ),
      ),
    ).toBe("inventory.reservation_not_found");
    expect(
      await codeOf(
        releaseReservationByStaff({ reservationId, reason: "other" as never }, assistant),
      ),
    ).toBe("kernel.validation_failed");
  });
});

describe("consumeReservation", () => {
  it("writes exactly one sale movement and lowers on hand; the reservation is consumed", async () => {
    const productId = await stocked(10);
    const holderRef = holder();
    await reserveStock({ productId, quantity: 4, holderRef }, checkout);
    await confirm(holderRef, checkout);
    const result = await consumeReservation({ holderRef }, checkout);
    expect(result.reservations).toHaveLength(1);
    const sales = await iso.sql<{ delta: number; reason: string; id: string }[]>`
      SELECT id, delta, reason FROM inventory.stock_movements WHERE product_id = ${productId} AND reason = 'sale'`;
    expect(sales).toEqual([{ id: result.reservations[0]?.movementId, delta: -4, reason: "sale" }]);
    expect((await rowsOf(productId))[0]?.status).toBe("consumed");
    const stock = await stockOf(productId);
    expect([stock.onHand, stock.ordered, stock.available]).toEqual([6, 0, 6]);
    const [level] = await iso.sql<{ on_hand: number }[]>`
      SELECT on_hand FROM inventory.stock_levels WHERE product_id = ${productId}`;
    expect(level?.on_hand).toBe(6);
  });

  it("consuming twice is refused and writes nothing more", async () => {
    const productId = await stocked(10);
    const holderRef = holder();
    await reserveStock({ productId, quantity: 4, holderRef }, checkout);
    await confirm(holderRef, checkout);
    await consumeReservation({ holderRef }, checkout);
    expect(await codeOf(consumeReservation({ holderRef }, checkout))).toBe(
      "inventory.reservation_not_active",
    );
    expect(await codeOf(consumeReservation({ holderRef: holder() }, checkout))).toBe(
      "inventory.reservation_not_found",
    );
    const [row] = await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM inventory.stock_movements WHERE product_id = ${productId} AND reason = 'sale'`;
    expect(row?.n).toBe(1);
  });

  it("a hold that was never confirmed cannot be consumed", async () => {
    const productId = await stocked(10);
    const holderRef = holder();
    await reserveStock({ productId, quantity: 4, holderRef }, checkout);
    expect(await codeOf(consumeReservation({ holderRef }, checkout))).toBe(
      "inventory.reservation_not_confirmed",
    );
    expect((await rowsOf(productId))[0]?.status).toBe("active");
  });

  it("with the same idempotency key a retry replays the first answer: still one movement", async () => {
    const productId = await stocked(10);
    const holderRef = holder();
    await reserveStock({ productId, quantity: 2, holderRef }, checkout);
    await confirm(holderRef, checkout);
    const key = { idempotencyKey: `consume:${holderRef}` };
    const first = await consumeReservation({ holderRef }, checkout, key);
    const replay = await consumeReservation({ holderRef }, checkout, key);
    expect(replay).toEqual(first);
    const [row] = await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM inventory.stock_movements WHERE product_id = ${productId} AND reason = 'sale'`;
    expect(row?.n).toBe(1);
  });

  it("consumes several products of one order together, or none", async () => {
    const a = await stocked(5);
    const b = await stocked(1);
    const holderRef = holder();
    await reserveStock({ productId: a, quantity: 2, holderRef }, checkout);
    await reserveStock({ productId: b, quantity: 1, holderRef }, checkout);
    await confirm(holderRef, checkout);
    // the shelf of b is emptied behind the order's back: the whole consume is refused
    await adjustStock({ productId: b, delta: -1, reason: "adjustment", note: "breakage" }, owner);
    expect(await codeOf(consumeReservation({ holderRef }, checkout))).toBe(
      "inventory.negative_stock",
    );
    expect((await rowsOf(a))[0]?.status).toBe("active");
    expect((await stockOf(a)).onHand).toBe(5);
  });
});

describe("shortness", () => {
  it("a count that lowers on hand below the orders succeeds, and the product shows as short by how many", async () => {
    const productId = await stocked(10);
    const holderRef = holder();
    await reserveStock({ productId, quantity: 6, holderRef }, checkout);
    await confirm(holderRef, checkout);
    // the shelf really holds 4: the count is not refused
    const sku = (await getStock({ productId }, owner)).cnk;
    const prepared = await prepareStockImport({ csv: `cnk;quantity\n${sku};4\n` }, owner);
    expect((await importStock({ planId: prepared.planId }, owner)).changed).toBe(1);
    const stock = await stockOf(productId);
    expect([stock.onHand, stock.ordered, stock.available, stock.short]).toEqual([4, 6, 0, 2]);
    const list = await listStock({ q: sku }, owner);
    expect(list.items[0]).toMatchObject({ onHand: 4, reserved: 6, available: 0, short: 2 });
    // nothing more can be reserved
    expect(
      await codeOf(reserveStock({ productId, quantity: 1, holderRef: holder() }, checkout)),
    ).toBe("inventory.insufficient_stock");
  });

  it("holds do not make a product short, only orders do", async () => {
    const productId = await stocked(5);
    await reserveStock({ productId, quantity: 5, holderRef: holder() }, checkout);
    await adjustStock({ productId, delta: -3, reason: "adjustment", note: "breakage" }, owner);
    const stock = await stockOf(productId);
    expect([stock.onHand, stock.held, stock.short]).toEqual([2, 5, 0]);
  });
});

describe("the storefront", () => {
  it("inStock follows what is AVAILABLE, and the count is never returned", async () => {
    const productId = await stocked(2);
    expect(await getAvailability({ productIds: [productId] }, storefront)).toEqual([
      { productId, inStock: true },
    ]);
    const holderRef = holder();
    await reserveStock({ productId, quantity: 2, holderRef }, checkout);
    const [answer] = await getAvailability({ productIds: [productId] }, storefront);
    expect(answer).toEqual({ productId, inStock: false });
    expect(Object.keys(answer ?? {}).sort()).toEqual(["inStock", "productId"]);
    // released: back in stock
    await releaseReservation({ holderRef, reason: "checkout_cancelled" }, checkout);
    expect((await getAvailability({ productIds: [productId] }, storefront))[0]?.inStock).toBe(true);
  });

  it("an expired hold is back in stock at once", async () => {
    const productId = await stocked(1);
    await reserveStock({ productId, quantity: 1, holderRef: holder() }, checkout);
    expect((await getAvailability({ productIds: [productId] }, storefront))[0]?.inStock).toBe(
      false,
    );
    kernel.clock.set(at(15 * MINUTE));
    expect((await getAvailability({ productIds: [productId] }, storefront))[0]?.inStock).toBe(true);
  });
});

describe("who may call what", () => {
  it("only the system reservations role runs the commands; staff, the owner and the storefront are refused", async () => {
    const productId = await stocked(5);
    const holderRef = holder();
    for (const actor of [owner, pharmacist, assistant, storefront]) {
      const label = actor.roles.join(",");
      expect(await codeOf(reserveStock({ productId, quantity: 1, holderRef }, actor)), label).toBe(
        "kernel.forbidden",
      );
      expect(await codeOf(confirm(holderRef, actor)), label).toBe(
        "kernel.forbidden",
      );
      expect(
        await codeOf(releaseReservation({ holderRef, reason: "refunded" }, actor)),
        label,
      ).toBe("kernel.forbidden");
      expect(await codeOf(consumeReservation({ holderRef }, actor)), label).toBe(
        "kernel.forbidden",
      );
      expect(await codeOf(expireReservations({}, actor)), label).toBe("kernel.forbidden");
    }
    expect(await rowsOf(productId)).toEqual([]);
  });

  it("the checkout role cannot do staff things; staff release needs stock.manage", async () => {
    const productId = await stocked(5);
    const { reservationId } = await reserveStock(
      { productId, quantity: 1, holderRef: holder() },
      checkout,
    );
    expect(
      await codeOf(
        releaseReservationByStaff({ reservationId, reason: "staff_correction" }, checkout),
      ),
    ).toBe("kernel.forbidden");
    expect(
      await codeOf(adjustStock({ productId, delta: 1, reason: "adjustment", note: "x" }, checkout)),
    ).toBe("kernel.forbidden");
    expect(
      await codeOf(
        releaseReservationByStaff(
          { reservationId, reason: "staff_correction" },
          staff("content_editor"),
        ),
      ),
    ).toBe("kernel.forbidden");
    expect(await codeOf(getStock({ productId }, storefront))).toBe("kernel.forbidden");
  });
});

describe("the database enforces the lifecycle whoever writes", () => {
  const raw = async (run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      return String((error as { message?: string }).message ?? error);
    }
    return "ok";
  };

  it("expires_at is required for a hold and always NULL for an order", async () => {
    const productId = await product();
    const insert = (kind: string, expires: string | null) => iso.sql`
      INSERT INTO inventory.reservations
        (id, product_id, location_id, quantity, kind, holder_ref, status, expires_at,
         created_by_type, created_by_id, updated_by_type, updated_by_id)
      VALUES (gen_random_uuid(), ${productId}, '0192f000-0000-7000-8000-000000000001', 1, ${kind},
        ${holder()}, 'active', ${expires}, 'system', 'raw', 'system', 'raw')`;
    expect(await raw(() => insert("hold", null))).toContain("reservations_expires_at_check");
    expect(await raw(() => insert("order", at(MINUTE).toISOString()))).toContain(
      "reservations_expires_at_check",
    );
    expect(await raw(() => insert("hold", at(MINUTE).toISOString()))).toBe("ok");
    expect(await raw(() => insert("order", null))).toBe("ok");
  });

  it("a quantity of zero, an unknown kind or status, and a holder reference with personal data are refused", async () => {
    const productId = await product();
    const insert = (quantity: number, kind: string, status: string, holderRef: string) => iso.sql`
      INSERT INTO inventory.reservations
        (id, product_id, location_id, quantity, kind, holder_ref, status, expires_at,
         created_by_type, created_by_id, updated_by_type, updated_by_id)
      VALUES (gen_random_uuid(), ${productId}, '0192f000-0000-7000-8000-000000000001', ${quantity}, ${kind},
        ${holderRef}, ${status}, NULL, 'system', 'raw', 'system', 'raw')`;
    expect(await raw(() => insert(0, "order", "active", "ok-1"))).toContain(
      "reservations_quantity_check",
    );
    expect(await raw(() => insert(1, "cart", "active", "ok-2"))).toMatch(
      /reservations_kind_check|reservations_expires_at_check/,
    );
    expect(await raw(() => insert(1, "order", "pending", "ok-3"))).toContain(
      "reservations_status_check",
    );
    expect(await raw(() => insert(1, "order", "active", "jan@example.be"))).toContain(
      "reservations_holder_ref_check",
    );
    // an order cannot be expired, a hold cannot be consumed
    expect(await raw(() => insert(1, "order", "expired", "ok-4"))).toContain(
      "reservations_only_holds_expire_check",
    );
    expect(await raw(() => insert(1, "order", "released", "ok-5"))).toContain(
      "reservations_release_reason_check",
    );
  });

  it("only the arrows are allowed: an end state is final, the identity never changes, an order never turns back", async () => {
    const productId = await stocked(10);
    const holderRef = holder();
    const { reservationId } = await reserveStock({ productId, quantity: 2, holderRef }, checkout);
    expect(
      await raw(
        () => iso.sql`UPDATE inventory.reservations SET quantity = 9 WHERE id = ${reservationId}`,
      ),
    ).toContain("keeps its product, quantity, holder and creator");
    expect(
      await raw(
        () =>
          iso.sql`UPDATE inventory.reservations SET holder_ref = 'someone-else' WHERE id = ${reservationId}`,
      ),
    ).toContain("keeps its product, quantity, holder and creator");
    await confirm(holderRef, checkout);
    expect(
      await raw(
        () => iso.sql`
        UPDATE inventory.reservations SET kind = 'hold', expires_at = now() + interval '5 minutes'
        WHERE id = ${reservationId}`,
      ),
    ).toContain("may only turn from a hold into an order");
    await releaseReservation({ holderRef, reason: "refunded" }, checkout);
    expect(
      await raw(
        () => iso.sql`
        UPDATE inventory.reservations SET status = 'active', release_reason = NULL WHERE id = ${reservationId}`,
      ),
    ).toContain("is released and cannot change");
  });

  it("reservations are kept: no DELETE, no TRUNCATE", async () => {
    const productId = await stocked(5);
    await reserveStock({ productId, quantity: 1, holderRef: holder() }, checkout);
    expect(
      await raw(() => iso.sql`DELETE FROM inventory.reservations WHERE product_id = ${productId}`),
    ).toContain("reservations are kept");
    expect(await raw(() => iso.sql`TRUNCATE inventory.reservations`)).toContain(
      "reservations are kept",
    );
    expect(await rowsOf(productId)).toHaveLength(1);
  });

  it("one active reservation per product and holder, even for a raw insert", async () => {
    const productId = await stocked(5);
    const holderRef = holder();
    await reserveStock({ productId, quantity: 1, holderRef }, checkout);
    const message = await raw(
      () => iso.sql`
        INSERT INTO inventory.reservations
          (id, product_id, location_id, quantity, kind, holder_ref, status, expires_at,
           created_by_type, created_by_id, updated_by_type, updated_by_id)
        VALUES (gen_random_uuid(), ${productId}, '0192f000-0000-7000-8000-000000000001', 1, 'order',
          ${holderRef}, 'active', NULL, 'system', 'raw', 'system', 'raw')`,
    );
    expect(message).toContain("reservations_active_holder_idx");
  });
});

describe("audit", () => {
  it("reserve, confirm, consume are audited with ids and a quantity, nothing else", async () => {
    const productId = await stocked(5);
    const holderRef = holder();
    const { reservationId } = await reserveStock({ productId, quantity: 2, holderRef }, checkout);
    await confirm(holderRef, checkout);
    const { reservations } = await consumeReservation({ holderRef }, checkout);
    const events = await iso.sql<{ action: string; data: Record<string, unknown> }[]>`
      SELECT action, data FROM audit.events
      WHERE entity_id = ${productId} AND action LIKE 'inventory.reservation.%' ORDER BY seq`;
    expect(events).toEqual([
      { action: "inventory.reservation.reserved", data: { reservationId, productId, quantity: 2 } },
      {
        action: "inventory.reservation.confirmed",
        data: { reservationId, productId, quantity: 2 },
      },
      {
        action: "inventory.reservation.consumed",
        data: { reservationId, productId, quantity: 2, movementId: reservations[0]?.movementId },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(holderRef);
  });
});
