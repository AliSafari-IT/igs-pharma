// Lots of the web pool (igs-pharma#164, ADR 0011) against real Postgres: the medicine lot rule,
// `no_lot`, legacy `unknown` stock, the expiry buffer, quarantine, FEFO picking and the guards.
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
  DEFAULT_LOCATION_ID,
  EXPIRY_BUFFER_DEFAULT_DAYS,
  adjustStock,
  assignUnknownLot,
  confirmReservation,
  consumeReservation,
  getAvailability,
  getInventorySettings,
  getStock,
  getStockSummary,
  quarantineLot,
  receiveStock,
  registerAuditActions,
  releaseLot,
  reserveStock,
  returnStock,
  setExpiryBuffer,
} from "../src";
import { addDays, expiryStateOf } from "../src/domain";
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
const assistant = staff("pharmacy_assistant");
const checkout: Actor = { type: "system", id: "checkout", roles: ["system_reservations"] };
const storefront: Actor = { type: "system", id: "storefront", roles: ["system_storefront"] };

let nextCnk = 9_600_100;

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
        { locale: "nl", name: `Lot ${cnk}` },
        { locale: "fr", name: `Lot ${cnk} FR` },
      ],
    },
    pharmacist,
  );
  await setProductStatusRegulated({ productId, status: "active" }, pharmacist);
  return productId;
}

const today = () => brusselsToday(kernel.clock.now());
/** An expiry date `days` after today (Brussels). */
const expiresIn = (days: number) => addDays(today(), days);

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "ok";
};

const fieldsOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return { code: error.code, fields: error.fields };
    throw error;
  }
  return { code: "ok", fields: undefined };
};

const stock = (productId: string) => getStock({ productId }, pharmacist);
const sellable = async (productId: string) => (await stock(productId)).sellable;

const audited = (productId: string, action: string) =>
  iso.sql<{ actor_id: string; data: Record<string, unknown> }[]>`
    SELECT actor_id, data FROM audit.events WHERE entity_id = ${productId} AND action = ${action}
    ORDER BY seq`;

describe("the dates", () => {
  it("today is the Brussels calendar date, also just after midnight there", () => {
    expect(brusselsToday(new Date("2026-10-21T21:30:00Z"))).toBe("2026-10-21"); // 23:30 CEST
    expect(brusselsToday(new Date("2026-10-21T22:30:00Z"))).toBe("2026-10-22"); // 00:30 CEST
    expect(brusselsToday(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-16"); // 00:30 CET
  });

  it("a lot is sellable only when its expiry is more than the buffer away", () => {
    const on = "2026-10-21";
    expect(expiryStateOf(null, on, 30)).toBe("sellable");
    expect(expiryStateOf("2026-11-21", on, 30)).toBe("sellable"); // 31 days
    expect(expiryStateOf("2026-11-20", on, 30)).toBe("within_expiry_buffer"); // 30 days
    expect(expiryStateOf("2026-10-22", on, 30)).toBe("within_expiry_buffer");
    expect(expiryStateOf("2026-10-21", on, 30)).toBe("expired");
    expect(expiryStateOf("2026-10-20", on, 30)).toBe("expired");
    expect(expiryStateOf("2026-10-22", on, 0)).toBe("sellable");
  });
});

describe("receiving into the web pool", () => {
  it("a medicine needs a lot number and an expiry date; never a no_lot lot", async () => {
    const id = await product();
    expect(await fieldsOf(receiveStock({ productId: id, quantity: 5 }, owner))).toMatchObject({
      fields: [
        { path: "lotNumber", code: "required" },
        { path: "expiryDate", code: "required" },
      ],
    });
    expect(await codeOf(receiveStock({ productId: id, quantity: 5, lotNumber: "A1" }, owner))).toBe(
      "inventory.lot_required",
    );
    expect(
      await codeOf(
        adjustStock({ productId: id, delta: 5, reason: "correction", note: "x" }, owner),
      ),
    ).toBe("inventory.lot_required");
    const { lotId, lotOnHand } = await receiveStock(
      { productId: id, quantity: 5, lotNumber: "A1", expiryDate: expiresIn(200) },
      assistant,
    );
    expect(lotOnHand).toBe(5);
    const view = await stock(id);
    expect(view).toMatchObject({ onHand: 5, sellable: 5, available: 5, isMedicine: true });
    expect(view.lots).toMatchObject([
      { lotId, tracking: "lot", lotNumber: "A1", expiryState: "sellable", sellable: true },
    ]);
    // the same lot again adds to it
    await receiveStock(
      { productId: id, quantity: 2, lotNumber: "A1", expiryDate: expiresIn(200) },
      owner,
    );
    expect((await stock(id)).lots).toHaveLength(1);
    expect(await audited(id, "inventory.stock.received")).toMatchObject([
      { actor_id: assistant.id, data: { productId: id, lotId, quantity: 5 } },
      { actor_id: owner.id, data: { productId: id, lotId, quantity: 2 } },
    ]);
    // no lot number, expiry or note in the audit trail
    expect(JSON.stringify(await audited(id, "inventory.stock.received"))).not.toContain("A1");
  });

  it("another product without a lot lands in its single no_lot lot (a kind, not a lot number)", async () => {
    const id = await product(false);
    await receiveStock({ productId: id, quantity: 3 }, owner);
    await receiveStock({ productId: id, quantity: 4 }, owner);
    const { lots } = await stock(id);
    expect(lots).toMatchObject([
      { tracking: "no_lot", lotNumber: null, expiryDate: null, onHand: 7, sellable: true },
    ]);
    // a lot number alone is fine; an expiry date alone is not
    await receiveStock({ productId: id, quantity: 1, lotNumber: "B-7" }, owner);
    expect(
      await codeOf(receiveStock({ productId: id, quantity: 1, expiryDate: expiresIn(90) }, owner)),
    ).toBe("inventory.lot_required");
    expect((await stock(id)).lots.map((lot) => lot.tracking).sort()).toEqual(["lot", "no_lot"]);
  });

  it("expired stock never enters the pool; an odd lot number is refused", async () => {
    const id = await product();
    for (const expiryDate of [today(), expiresIn(-1)]) {
      expect(
        await codeOf(
          receiveStock({ productId: id, quantity: 1, lotNumber: "X1", expiryDate }, owner),
        ),
      ).toBe("inventory.expiry_in_past");
    }
    expect(
      await codeOf(
        receiveStock(
          { productId: id, quantity: 1, lotNumber: "<script>", expiryDate: expiresIn(90) },
          owner,
        ),
      ),
    ).toBe("kernel.validation_failed");
  });

  it("returns leave from one lot and never take it below zero", async () => {
    const id = await product();
    const { lotId } = await receiveStock(
      { productId: id, quantity: 4, lotNumber: "R1", expiryDate: expiresIn(100) },
      owner,
    );
    expect(await returnStock({ lotId, quantity: 3 }, assistant)).toMatchObject({ lotOnHand: 1 });
    expect(await codeOf(returnStock({ lotId, quantity: 2 }, assistant))).toBe(
      "inventory.negative_stock",
    );
    expect(await audited(id, "inventory.stock.returned")).toHaveLength(1);
  });
});

describe("stock from before lots", () => {
  /** What the migration did with a medicine's stock: an `unknown` lot and its movement. */
  async function legacy(productId: string, quantity: number) {
    const lotId = newId();
    await iso.sql`
      INSERT INTO inventory.lots (id, product_id, location_id, tracking, created_by_type, created_by_id)
      VALUES (${lotId}, ${productId}, ${DEFAULT_LOCATION_ID}, 'unknown', 'system', 'migration')`;
    await iso.sql`
      INSERT INTO inventory.stock_movements (id, product_id, location_id, lot_id, delta, reason, actor_type, actor_id)
      VALUES (${newId()}, ${productId}, ${DEFAULT_LOCATION_ID}, ${lotId}, ${quantity}, 'import', 'system', 'migration')`;
    return lotId;
  }

  it("is never sellable until staff record its lot; then it sells again", async () => {
    const id = await product();
    await legacy(id, 6);
    expect(await stock(id)).toMatchObject({ onHand: 6, sellable: 0, available: 0 });
    expect(await getAvailability({ productIds: [id] }, storefront)).toEqual([
      { productId: id, inStock: false },
    ]);
    expect(
      await codeOf(
        reserveStock({ productId: id, quantity: 1, holderRef: `checkout:${newId()}` }, checkout),
      ),
    ).toBe("inventory.insufficient_stock");
    expect((await stock(id)).lots[0]).toMatchObject({ tracking: "unknown", sellable: false });

    const { unknownOnHand } = await assignUnknownLot(
      { productId: id, quantity: 4, lotNumber: "L-OLD", expiryDate: expiresIn(120) },
      assistant,
    );
    expect(unknownOnHand).toBe(2);
    expect(await stock(id)).toMatchObject({ onHand: 6, sellable: 4 });
    expect(await getAvailability({ productIds: [id] }, storefront)).toEqual([
      { productId: id, inStock: true },
    ]);
    expect(await getStockSummary({}, pharmacist)).toMatchObject({ flaggedLots: 1 });
  });
});

describe("the expiry buffer", () => {
  it("a lot within the buffer stays on hand, is flagged and is not sellable", async () => {
    const id = await product();
    await receiveStock(
      { productId: id, quantity: 2, lotNumber: "SOON", expiryDate: expiresIn(30) },
      owner,
    );
    await receiveStock(
      { productId: id, quantity: 3, lotNumber: "LATER", expiryDate: expiresIn(31) },
      owner,
    );
    const view = await stock(id);
    expect(view).toMatchObject({ onHand: 5, sellable: 3, available: 3 });
    expect(view.lots.map((lot) => [lot.lotNumber, lot.expiryState])).toEqual([
      ["SOON", "within_expiry_buffer"],
      ["LATER", "sellable"],
    ]);
    const listed = (await getStockSummary({}, pharmacist)).flaggedLots;
    expect(listed).toBeGreaterThanOrEqual(1);
  });

  it("only the titular changes it (audited); it applies everywhere at once", async () => {
    const id = await product();
    await receiveStock(
      { productId: id, quantity: 2, lotNumber: "B40", expiryDate: expiresIn(40) },
      owner,
    );
    expect(await sellable(id)).toBe(2);
    for (const actor of [owner, pharmacist, assistant]) {
      expect(await codeOf(setExpiryBuffer({ days: 60 }, actor))).toBe("kernel.forbidden");
    }
    await setExpiryBuffer({ days: 60 }, titular);
    expect(await getInventorySettings({}, assistant)).toEqual({ expiryBufferDays: 60 });
    expect(await sellable(id)).toBe(0);
    expect((await stock(id)).lots[0]?.expiryState).toBe("within_expiry_buffer");
    // the same value again is no change and no audit entry
    await setExpiryBuffer({ days: 60 }, titular);
    await setExpiryBuffer({ days: EXPIRY_BUFFER_DEFAULT_DAYS }, titular);
    expect(await sellable(id)).toBe(2);
    expect(
      await iso.sql`SELECT actor_id, data FROM audit.events
        WHERE action = 'inventory.settings.expiry_buffer_set' ORDER BY seq`,
    ).toEqual([
      { actor_id: titular.id, data: { from: 30, to: 60 } },
      { actor_id: titular.id, data: { from: 60, to: 30 } },
    ]);
    expect(await codeOf(setExpiryBuffer({ days: 400 }, titular))).toBe("kernel.validation_failed");
  });
});

describe("quarantine", () => {
  it("a pharmacist takes a lot out of sale and back; owner and assistant cannot", async () => {
    const id = await product();
    const { lotId } = await receiveStock(
      { productId: id, quantity: 5, lotNumber: "Q1", expiryDate: expiresIn(200) },
      owner,
    );
    for (const actor of [owner, assistant]) {
      expect(await codeOf(quarantineLot({ lotId, reason: "recall" }, actor))).toBe(
        "kernel.forbidden",
      );
    }
    await quarantineLot({ lotId, reason: "recall" }, pharmacist);
    expect(await stock(id)).toMatchObject({ onHand: 5, sellable: 0 });
    expect((await stock(id)).lots[0]).toMatchObject({
      quarantine: { reason: "recall" },
      sellable: false,
    });
    expect(await codeOf(quarantineLot({ lotId, reason: "quality" }, pharmacist))).toBe(
      "inventory.lot_quarantined",
    );
    await releaseLot({ lotId }, titular);
    expect(await sellable(id)).toBe(5);
    expect(await codeOf(releaseLot({ lotId }, pharmacist))).toBe("inventory.lot_not_quarantined");
    expect(
      (await audited(id, "inventory.lot.quarantined")).concat(
        await audited(id, "inventory.lot.released"),
      ),
    ).toMatchObject([
      { actor_id: pharmacist.id, data: { lotId, reason: "recall" } },
      { actor_id: titular.id, data: { lotId, reason: "recall" } },
    ]);
  });
});

describe("picking (FEFO)", () => {
  async function order(productId: string, quantity: number) {
    const holderRef = `checkout:${newId()}`;
    await reserveStock({ productId, quantity, holderRef }, checkout);
    await confirmReservation({ holderRef, items: [{ productId, quantity }] }, checkout);
    return holderRef;
  }

  it("takes the earliest-expiring sellable lots first, never a non-sellable one", async () => {
    const id = await product();
    const late = await receiveStock(
      { productId: id, quantity: 5, lotNumber: "LATE", expiryDate: expiresIn(300) },
      owner,
    );
    const early = await receiveStock(
      { productId: id, quantity: 2, lotNumber: "EARLY", expiryDate: expiresIn(100) },
      owner,
    );
    const blocked = await receiveStock(
      { productId: id, quantity: 9, lotNumber: "BLOCKED", expiryDate: expiresIn(50) },
      owner,
    );
    await quarantineLot({ lotId: blocked.lotId, reason: "damaged" }, pharmacist);

    await consumeReservation({ holderRef: await order(id, 3) }, checkout);
    const byLot = new Map((await stock(id)).lots.map((lot) => [lot.lotId, lot.onHand]));
    expect(byLot.get(early.lotId)).toBe(0);
    expect(byLot.get(late.lotId)).toBe(4);
    expect(byLot.get(blocked.lotId)).toBe(9);
  });

  it("an order whose sellable stock went away is refused at pickup, never picked from a blocked lot", async () => {
    const id = await product();
    const { lotId } = await receiveStock(
      { productId: id, quantity: 2, lotNumber: "ONLY", expiryDate: expiresIn(200) },
      owner,
    );
    const holderRef = await order(id, 2);
    await quarantineLot({ lotId, reason: "quality" }, pharmacist);
    expect(await codeOf(consumeReservation({ holderRef }, checkout))).toBe(
      "inventory.stock_not_sellable",
    );
    expect((await stock(id)).onHand).toBe(2);
  });
});

describe("the database", () => {
  it("refuses negative stock per lot, a lot of another product, and changing or removing a lot", async () => {
    const a = await product();
    const b = await product();
    const lot = await receiveStock(
      { productId: a, quantity: 1, lotNumber: "G1", expiryDate: expiresIn(90) },
      owner,
    );
    // another lot keeps the product's total up: only the lot's own level can refuse
    await receiveStock(
      { productId: a, quantity: 5, lotNumber: "G9", expiryDate: expiresIn(90) },
      owner,
    );
    const move = (productId: string, delta: number) => iso.sql`
      INSERT INTO inventory.stock_movements (id, product_id, location_id, lot_id, delta, reason, actor_type, actor_id)
      VALUES (${newId()}, ${productId}, ${DEFAULT_LOCATION_ID}, ${lot.lotId}, ${delta}, 'adjustment', 'system', 'raw')`;
    await expect(move(a, -2)).rejects.toThrow(/lot_levels_on_hand_check/);
    await expect(move(b, 1)).rejects.toThrow(/not a lot of this product/);
    await expect(
      iso.sql`UPDATE inventory.lots SET lot_number = 'G2' WHERE id = ${lot.lotId}`,
    ).rejects.toThrow(/keeps its product/);
    await expect(iso.sql`DELETE FROM inventory.lots WHERE id = ${lot.lotId}`).rejects.toThrow();
    await expect(
      iso.sql`INSERT INTO inventory.lots (id, product_id, location_id, tracking, lot_number, created_by_type, created_by_id)
        VALUES (${newId()}, ${a}, ${DEFAULT_LOCATION_ID}, 'no_lot', 'X', 'system', 'raw')`,
    ).rejects.toThrow(/lots_lot_number_check/);
    await expect(iso.sql`DELETE FROM inventory.settings`).rejects.toThrow();
  });
});
