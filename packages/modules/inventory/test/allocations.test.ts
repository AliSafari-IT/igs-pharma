// Lot allocation of order reservations (igs-pharma#165, ADR 0011 §4) against real Postgres: FEFO
// order, mixed lots and `no_lot`, re-allocation when a lot stops being sellable or holds less,
// short orders, consumption lot by lot, the hourly check, the audit trail and the database guard.
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
  adjustStock,
  checkAllocation,
  confirmReservation,
  consumeReservation,
  fefoCompare,
  getStockSummary,
  listHolderAllocations,
  quarantineLot,
  reallocateOrders,
  receiveStock,
  registerAuditActions,
  releaseLot,
  releaseReservation,
  reserveStock,
  returnStock,
  setExpiryBuffer,
} from "../src";
import { addDays } from "../src/domain";
import { brusselsToday } from "../src/ledger";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  registerCatalogAudit(registerAuditAction);
  registerAuditActions(registerAuditAction);
});
afterAll(async () => {
  await iso?.drop();
});
beforeEach(() => {
  kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  kernel.clock.set(new Date());
});

const staff = (...roles: string[]): Actor => ({
  type: "user",
  id: randomUUID(),
  roles,
  kind: "staff",
  mfaVerified: true,
});
const owner = staff("owner");
const titular = staff("pharmacist_titular");
const pharmacist = staff("pharmacist");
const checkout: Actor = { type: "system", id: "checkout", roles: ["system_reservations"] };

let nextCnk = 9_700_100;

/** An active product, a medicine unless `medicine` is false. */
async function product(medicine = true): Promise<string> {
  const cnk = String(nextCnk++);
  const { productId } = await createProductRegulated(
    {
      cnk,
      productType: medicine ? "otc_medicine" : "medical_device",
      legalStatus: medicine ? "otc" : "general_sale",
      vatClass: medicine ? "BE_6" : "BE_21",
      approveContent: true,
      content: [
        { locale: "nl", name: `Alloc ${cnk}` },
        { locale: "fr", name: `Alloc ${cnk} FR` },
      ],
    },
    pharmacist,
  );
  await setProductStatusRegulated({ productId, status: "active" }, pharmacist);
  return productId;
}

const today = () => brusselsToday(kernel.clock.now());
const expiresIn = (days: number) => addDays(today(), days);

/** Receives `quantity` into a lot (`lotNumber` undefined: the product's `no_lot` lot). */
async function receive(
  productId: string,
  quantity: number,
  lotNumber?: string,
  expiryDays?: number,
): Promise<string> {
  const { lotId } = await receiveStock(
    {
      productId,
      quantity,
      ...(lotNumber ? { lotNumber } : {}),
      ...(expiryDays === undefined ? {} : { expiryDate: expiresIn(expiryDays) }),
    },
    owner,
  );
  return lotId;
}

/** A paid order of `quantity`: a hold confirmed at once. */
async function order(productId: string, quantity: number): Promise<string> {
  const holderRef = `checkout:${newId()}`;
  await reserveStock({ productId, quantity, holderRef }, checkout);
  await confirmReservation({ holderRef, items: [{ productId, quantity }] }, checkout);
  return holderRef;
}

/** The order's allocation as `[lotId, quantity]` pairs, in picking order, and how much it got. */
async function allocationOf(holderRef: string) {
  const [line] = await listHolderAllocations({ holderRef }, pharmacist);
  return {
    lots: (line?.lots ?? []).map((lot) => [lot.lotId, lot.quantity]),
    allocated: line?.allocated ?? 0,
    quantity: line?.quantity ?? 0,
  };
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

const audited = (productId: string, action: string) =>
  iso.sql<{ data: Record<string, unknown> }[]>`
    SELECT data FROM audit.events WHERE entity_id = ${productId} AND action = ${action}
    ORDER BY seq`;

const raw = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }
  return "ok";
};

describe("FEFO", () => {
  it("orders lots by expiry, lots without one after, no_lot last, then by lot id", () => {
    const lots = [
      { lotId: "d", tracking: "no_lot" as const, expiryDate: null },
      { lotId: "c", tracking: "lot" as const, expiryDate: null },
      { lotId: "b", tracking: "lot" as const, expiryDate: "2027-03-01" },
      { lotId: "a", tracking: "lot" as const, expiryDate: "2027-03-01" },
      { lotId: "e", tracking: "lot" as const, expiryDate: "2027-01-01" },
    ];
    expect([...lots].sort(fefoCompare).map((lot) => lot.lotId)).toEqual(["e", "a", "b", "c", "d"]);
  });

  it("a paid order takes the earliest-expiring sellable lots first, audited per lot", async () => {
    const id = await product();
    const later = await receive(id, 5, "LATER", 200);
    const soon = await receive(id, 3, "SOON", 100);
    await receive(id, 10, "LAST", 300);
    const holderRef = await order(id, 6);
    expect(await allocationOf(holderRef)).toEqual({
      lots: [
        [soon, 3],
        [later, 3],
      ],
      allocated: 6,
      quantity: 6,
    });
    const rows = await audited(id, "inventory.allocation.allocated");
    expect(rows.map((row) => [row.data["lotId"], row.data["quantity"], row.data["cause"]])).toEqual(
      expect.arrayContaining([
        [soon, 3, "confirmed"],
        [later, 3, "confirmed"],
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it("mixed lots of a non-medicine: dated lots, then undated, the no_lot lot last", async () => {
    const id = await product(false);
    const noLot = await receive(id, 10);
    const undated = await receive(id, 4, "UNDATED");
    const dated = await receive(id, 2, "DATED", 60);
    const holderRef = await order(id, 7);
    expect((await allocationOf(holderRef)).lots).toEqual([
      [dated, 2],
      [undated, 4],
      [noLot, 1],
    ]);
  });

  it("two lots with the same expiry: the lower lot id first, every time", async () => {
    const id = await product();
    const first = await receive(id, 2, "TWIN-A", 90);
    const second = await receive(id, 2, "TWIN-B", 90);
    const [low, high] = [first, second].sort();
    expect((await allocationOf(await order(id, 3))).lots).toEqual([
      [low, 2],
      [high, 1],
    ]);
  });

  it("an older order keeps its lots; a newer one gets what is left", async () => {
    const id = await product();
    const soon = await receive(id, 3, "SOON", 60);
    const later = await receive(id, 5, "LATER", 120);
    const first = await order(id, 3);
    const second = await order(id, 2);
    expect((await allocationOf(first)).lots).toEqual([[soon, 3]]);
    expect((await allocationOf(second)).lots).toEqual([[later, 2]]);
  });

  it("a hold is never allocated: only a paid order is", async () => {
    const id = await product();
    await receive(id, 3, "HOLD", 60);
    const holderRef = `checkout:${newId()}`;
    await reserveStock({ productId: id, quantity: 2, holderRef }, checkout);
    expect(await listHolderAllocations({ holderRef }, pharmacist)).toEqual([]);
  });
});

describe("allocating again", () => {
  it("a quarantined lot's orders move to the next sellable lot", async () => {
    const id = await product();
    const soon = await receive(id, 3, "Q-SOON", 60);
    const later = await receive(id, 5, "Q-LATER", 120);
    const holderRef = await order(id, 2);
    expect((await allocationOf(holderRef)).lots).toEqual([[soon, 2]]);

    await quarantineLot({ lotId: soon, reason: "recall" }, pharmacist);
    expect(await allocationOf(holderRef)).toMatchObject({ lots: [[later, 2]], allocated: 2 });
    const superseded = await audited(id, "inventory.allocation.superseded");
    expect(superseded.map((row) => [row.data["lotId"], row.data["cause"]])).toEqual([
      [soon, "lot_not_sellable"],
    ]);
    const allocated = await audited(id, "inventory.allocation.allocated");
    expect(allocated.at(-1)?.data).toMatchObject({ lotId: later, cause: "lot_not_sellable" });
  });

  it("when sellable stock no longer covers it, the order is short: flagged, not packed, not picked", async () => {
    const id = await product();
    const only = await receive(id, 4, "ONLY", 90);
    const holderRef = await order(id, 4);
    const before = await getStockSummary({}, pharmacist);

    await quarantineLot({ lotId: only, reason: "quality" }, pharmacist);
    expect(await allocationOf(holderRef)).toMatchObject({ lots: [], allocated: 0, quantity: 4 });
    expect((await getStockSummary({}, pharmacist)).unallocatedOrders).toBe(
      before.unallocatedOrders + 1,
    );
    const short = await audited(id, "inventory.allocation.short");
    expect(short.at(-1)?.data).toMatchObject({
      quantity: 4,
      allocated: 0,
      cause: "lot_not_sellable",
    });
    expect(await codeOf(checkAllocation({ holderRef }, checkout))).toBe(
      "inventory.allocation_short",
    );
    expect(await codeOf(consumeReservation({ holderRef }, checkout))).toBe(
      "inventory.stock_not_sellable",
    );

    // the lot comes back: the order is allocated again and can be packed and picked
    await releaseLot({ lotId: only }, pharmacist);
    expect(await allocationOf(holderRef)).toMatchObject({ lots: [[only, 4]], allocated: 4 });
    expect((await audited(id, "inventory.allocation.allocated")).at(-1)?.data).toMatchObject({
      cause: "stock_added",
    });
    expect(await codeOf(checkAllocation({ holderRef }, checkout))).toBe("ok");
    expect(await codeOf(consumeReservation({ holderRef }, checkout))).toBe("ok");
  });

  it("a lot that holds less after a return gives its order what is left, the rest elsewhere", async () => {
    const id = await product();
    const soon = await receive(id, 3, "R-SOON", 60);
    const later = await receive(id, 5, "R-LATER", 120);
    const holderRef = await order(id, 3);
    await returnStock({ lotId: soon, quantity: 2 }, owner);
    expect((await allocationOf(holderRef)).lots).toEqual([
      [soon, 1],
      [later, 2],
    ]);
    expect((await audited(id, "inventory.allocation.superseded")).at(-1)?.data).toMatchObject({
      cause: "lot_short",
    });
  });

  it("a breakage adjustment re-allocates the same way", async () => {
    const id = await product();
    const soon = await receive(id, 2, "A-SOON", 60);
    const later = await receive(id, 2, "A-LATER", 120);
    const holderRef = await order(id, 2);
    await adjustStock(
      { productId: id, lotId: soon, delta: -2, reason: "adjustment", note: "broken" },
      owner,
    );
    expect((await allocationOf(holderRef)).lots).toEqual([[later, 2]]);
  });

  it("a released order's lots go to an older order that was short", async () => {
    const id = await product();
    const a = await receive(id, 2, "F-A", 60);
    const b = await receive(id, 2, "F-B", 120);
    const first = await order(id, 2);
    const second = await order(id, 2);
    expect((await allocationOf(first)).lots).toEqual([[a, 2]]);
    expect((await allocationOf(second)).lots).toEqual([[b, 2]]);

    await quarantineLot({ lotId: b, reason: "damaged" }, pharmacist);
    expect((await allocationOf(second)).allocated).toBe(0);
    await releaseReservation({ holderRef: first, reason: "order_cancelled" }, checkout);
    expect(await allocationOf(second)).toMatchObject({ lots: [[a, 2]], allocated: 2 });
    const [released] = await iso.sql<{ status: string }[]>`
      SELECT DISTINCT a.status FROM inventory.reservation_allocations a
      JOIN inventory.reservations r ON r.id = a.reservation_id
      WHERE r.holder_ref = ${first}`;
    expect(released?.status).toBe("released");
  });

  it("a longer expiry buffer moves orders off the lots it takes out of sale", async () => {
    const id = await product();
    const soon = await receive(id, 2, "B-SOON", 45);
    const later = await receive(id, 2, "B-LATER", 200);
    const holderRef = await order(id, 2);
    expect((await allocationOf(holderRef)).lots).toEqual([[soon, 2]]);
    await setExpiryBuffer({ days: 60 }, titular);
    try {
      expect((await allocationOf(holderRef)).lots).toEqual([[later, 2]]);
    } finally {
      await setExpiryBuffer({ days: 30 }, titular);
    }
  });

  it("the hourly check moves orders off a lot that crossed the buffer overnight, and is idempotent", async () => {
    const id = await product();
    const soon = await receive(id, 2, "N-SOON", 31);
    const later = await receive(id, 2, "N-LATER", 200);
    const holderRef = await order(id, 2);
    expect((await allocationOf(holderRef)).lots).toEqual([[soon, 2]]);

    kernel.clock.set(new Date(kernel.clock.now().getTime() + 2 * 24 * 60 * 60 * 1000));
    const result = await reallocateOrders({}, checkout);
    expect(result.orders).toBeGreaterThanOrEqual(1);
    expect((await allocationOf(holderRef)).lots).toEqual([[later, 2]]);

    const count = async () =>
      (
        await iso.sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM audit.events WHERE action LIKE 'inventory.allocation.%'`
      )[0]?.n;
    const before = await count();
    await reallocateOrders({}, checkout);
    await reallocateOrders({}, checkout);
    expect(await count()).toBe(before);
  });
});

describe("pickup", () => {
  it("consumes exactly the allocated lots: one sale movement per lot", async () => {
    const id = await product();
    const soon = await receive(id, 2, "P-SOON", 60);
    const later = await receive(id, 5, "P-LATER", 120);
    const holderRef = await order(id, 4);
    await consumeReservation({ holderRef }, checkout);
    const sales = await iso.sql<{ lot_id: string; delta: number }[]>`
      SELECT lot_id, delta FROM inventory.stock_movements
      WHERE product_id = ${id} AND reason = 'sale' ORDER BY lot_id`;
    expect(sales.map((row) => [row.lot_id, row.delta]).sort()).toEqual(
      [
        [soon, -2],
        [later, -2],
      ].sort(),
    );
    const statuses = await iso.sql<{ status: string }[]>`
      SELECT a.status FROM inventory.reservation_allocations a
      JOIN inventory.reservations r ON r.id = a.reservation_id
      WHERE r.holder_ref = ${holderRef} AND a.status <> 'superseded'`;
    expect(statuses.map((row) => row.status)).toEqual(["consumed", "consumed"]);
    expect(await listHolderAllocations({ holderRef }, pharmacist)).toEqual([]);
  });
});

describe("the database guard", () => {
  it("an allocation is only for an active order, from a lot of its product, and keeps its lot and quantity", async () => {
    const id = await product();
    const lot = await receive(id, 5, "G-LOT", 90);
    const other = await product();
    const otherLot = await receive(other, 5, "G-OTHER", 90);
    const holdRef = `checkout:${newId()}`;
    const { reservationId: holdId } = await reserveStock(
      { productId: id, quantity: 1, holderRef: holdRef },
      checkout,
    );
    const insert = (reservationId: string, lotId: string) =>
      iso.sql`
        INSERT INTO inventory.reservation_allocations
          (id, reservation_id, product_id, lot_id, quantity, created_by_type, created_by_id)
        VALUES (${newId()}, ${reservationId}, ${id}, ${lotId}, 1, 'system', 'test')`;
    expect(await raw(() => insert(holdId, lot))).toContain("only an active order reservation");

    const holderRef = await order(id, 2);
    const [row] = await iso.sql<{ id: string; reservation_id: string }[]>`
      SELECT a.id, a.reservation_id FROM inventory.reservation_allocations a
      JOIN inventory.reservations r ON r.id = a.reservation_id
      WHERE r.holder_ref = ${holderRef}`;
    const allocationId = row?.id as string;
    expect(await raw(() => insert(row?.reservation_id as string, otherLot))).toContain(
      "a lot of its own product",
    );
    expect(
      await raw(
        () =>
          iso.sql`UPDATE inventory.reservation_allocations SET quantity = 1 WHERE id = ${allocationId}`,
      ),
    ).toContain("keeps its reservation, lot and quantity");
    expect(
      await raw(
        () => iso.sql`DELETE FROM inventory.reservation_allocations WHERE id = ${allocationId}`,
      ),
    ).not.toBe("ok");
    await iso.sql`
      UPDATE inventory.reservation_allocations SET status = 'superseded' WHERE id = ${allocationId}`;
    expect(
      await raw(
        () =>
          iso.sql`UPDATE inventory.reservation_allocations SET status = 'active' WHERE id = ${allocationId}`,
      ),
    ).toContain("cannot go from superseded to active");
  });
});
