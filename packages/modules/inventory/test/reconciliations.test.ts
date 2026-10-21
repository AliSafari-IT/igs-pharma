// Reconciliation of web-pool lots (igs-pharma#166, ADR 0011 §1) against real Postgres: the preview
// is what applying writes, applying is idempotent, a lot that moved after the preview refuses the
// apply, unknown and ambiguous lots are refused, discard, typed counts, orders allocated again,
// the audit trail and the database guard.
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
  applyReconciliation,
  confirmReservation,
  discardReconciliation,
  getReconciliation,
  listHolderAllocations,
  listOpenReconciliations,
  receiveStock,
  registerAuditActions,
  reserveStock,
  startReconciliation,
  startReconciliationFromFile,
} from "../src";

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
const pharmacist = staff("pharmacist");
const assistant = staff("pharmacy_assistant");
const editor = staff("content_editor");
const checkout: Actor = { type: "system", id: "checkout", roles: ["system_reservations"] };

let nextCnk = 9_710_100;

/** An active product, a medicine unless `medicine` is false; returns its id and CNK. */
async function product(medicine = true): Promise<{ id: string; cnk: string }> {
  const cnk = String(nextCnk++);
  const { productId } = await createProductRegulated(
    {
      cnk,
      productType: medicine ? "otc_medicine" : "medical_device",
      legalStatus: medicine ? "otc" : "general_sale",
      vatClass: medicine ? "BE_6" : "BE_21",
      approveContent: true,
      content: [
        { locale: "nl", name: `Count ${cnk}` },
        { locale: "fr", name: `Count ${cnk} FR` },
      ],
    },
    pharmacist,
  );
  await setProductStatusRegulated({ productId, status: "active" }, pharmacist);
  return { id: productId, cnk };
}

/** Receives `quantity` into a lot (no `lotNumber`: the product's `no_lot` lot). */
async function receive(
  productId: string,
  quantity: number,
  lotNumber?: string,
  expiryDate = "2099-12-31",
): Promise<string> {
  const { lotId } = await receiveStock(
    { productId, quantity, ...(lotNumber ? { lotNumber, expiryDate } : {}) },
    owner,
  );
  return lotId;
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

const fieldsOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return { code: error.code, fields: error.fields };
    throw error;
  }
  return { code: "ok", fields: undefined };
};

const lotOnHand = async (lotId: string) =>
  (
    await iso.sql<{ on_hand: number }[]>`
      SELECT on_hand FROM inventory.lot_levels WHERE lot_id = ${lotId}`
  )[0]?.on_hand ?? 0;

const movementsOf = (reconciliationId: string) =>
  iso.sql<{ lot_id: string; delta: number; reason: string }[]>`
    SELECT lot_id, delta, reason FROM inventory.stock_movements
    WHERE import_id = ${reconciliationId} ORDER BY lot_id`;

const audited = (reconciliationId: string) =>
  iso.sql<{ action: string; data: Record<string, unknown> }[]>`
    SELECT action, data FROM audit.events WHERE entity_id = ${reconciliationId} ORDER BY seq`;

const raw = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }
  return "ok";
};

describe("a count file", () => {
  it("previews booked, counted and the difference per lot, and applying writes exactly that", async () => {
    const medicine = await product();
    const a = await receive(medicine.id, 5, "CNT-A", "2099-01-31");
    const b = await receive(medicine.id, 3, "CNT-B");
    const device = await product(false);
    const untracked = await receive(device.id, 10);

    const csv = [
      "cnk;lot;expiry;counted",
      `${medicine.cnk};CNT-A;31/01/2099;4`,
      `${medicine.cnk};CNT-B;;3`,
      `${device.cnk};;;12`,
    ].join("\n");
    const started = await startReconciliationFromFile({ csv }, assistant);
    expect(started).toMatchObject({ lines: 3, differing: 2 });
    // a preview moves nothing
    expect(await movementsOf(started.reconciliationId)).toEqual([]);
    expect([await lotOnHand(a), await lotOnHand(b), await lotOnHand(untracked)]).toEqual([
      5, 3, 10,
    ]);

    const preview = await getReconciliation(
      { reconciliationId: started.reconciliationId },
      pharmacist,
    );
    expect(preview.status).toBe("open");
    expect(
      preview.lines.map((line) => [
        line.lotId,
        line.booked,
        line.counted,
        line.difference,
        line.moved,
      ]),
    ).toEqual([
      [a, 5, 4, -1, false],
      [b, 3, 3, 0, false],
      [untracked, 10, 12, 2, false],
    ]);
    expect(await listOpenReconciliations({}, pharmacist)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reconciliationId: started.reconciliationId, lines: 3 }),
      ]),
    );

    const applied = await applyReconciliation(
      { reconciliationId: started.reconciliationId },
      assistant,
    );
    expect(applied).toEqual({ reconciliationId: started.reconciliationId, changed: 2 });
    expect(
      (await movementsOf(started.reconciliationId))
        .map((m) => [m.lot_id, m.delta, m.reason])
        .sort(),
    ).toEqual(
      [
        [a, -1, "reconciliation"],
        [untracked, 2, "reconciliation"],
      ].sort(),
    );
    expect([await lotOnHand(a), await lotOnHand(b), await lotOnHand(untracked)]).toEqual([
      4, 3, 12,
    ]);
    expect(
      (await getReconciliation({ reconciliationId: started.reconciliationId }, owner)).status,
    ).toBe("applied");
    expect(await audited(started.reconciliationId)).toEqual([
      {
        action: "inventory.reconciliation.started",
        data: { reconciliationId: started.reconciliationId, source: "csv", lines: 3, differing: 2 },
      },
      {
        action: "inventory.reconciliation.applied",
        data: { reconciliationId: started.reconciliationId, changed: 2 },
      },
    ]);
  });

  it("applying again changes nothing and answers the same", async () => {
    const p = await product(false);
    const lot = await receive(p.id, 6);
    const { reconciliationId } = await startReconciliationFromFile({ csv: `${p.cnk};;;2` }, owner);
    const first = await applyReconciliation({ reconciliationId }, owner);
    const second = await applyReconciliation({ reconciliationId }, assistant);
    expect(second).toEqual(first);
    expect(await movementsOf(reconciliationId)).toHaveLength(1);
    expect(await lotOnHand(lot)).toBe(2);
    expect(
      (await audited(reconciliationId)).filter(
        (e) => e.action === "inventory.reconciliation.applied",
      ),
    ).toHaveLength(1);
  });

  it("stock that moved after the preview refuses the apply, writing nothing", async () => {
    const p = await product(false);
    const lot = await receive(p.id, 5);
    const other = await product(false);
    const otherLot = await receive(other.id, 5);
    const { reconciliationId } = await startReconciliationFromFile(
      { csv: `${p.cnk};;;3\n${other.cnk};;;7` },
      owner,
    );
    // someone books a breakage meanwhile
    await adjustStock({ productId: p.id, delta: -1, reason: "adjustment", note: "broken" }, owner);
    const preview = await getReconciliation({ reconciliationId }, owner);
    expect(preview.lines.map((line) => line.moved)).toEqual([true, false]);
    expect(await fieldsOf(applyReconciliation({ reconciliationId }, owner))).toMatchObject({
      code: "inventory.reconciliation_stale",
    });
    expect(await movementsOf(reconciliationId)).toEqual([]);
    expect([await lotOnHand(lot), await lotOnHand(otherLot)]).toEqual([4, 5]);
    expect((await getReconciliation({ reconciliationId }, owner)).status).toBe("open");
    // a new count of the shelf as it is now applies
    const again = await startReconciliationFromFile(
      { csv: `${p.cnk};;;3\n${other.cnk};;;7` },
      owner,
    );
    expect(
      (await applyReconciliation({ reconciliationId: again.reconciliationId }, owner)).changed,
    ).toBe(2);
  });

  it("refuses unknown and ambiguous lots, a medicine without its lot and a lot counted twice, every line at once", async () => {
    const medicine = await product();
    await receive(medicine.id, 2, "TWIN", "2099-01-31");
    await receive(medicine.id, 2, "TWIN", "2099-06-30");
    await receive(medicine.id, 2, "SOLO");
    const device = await product(false);
    const csv = [
      `${medicine.cnk};NOPE;;1`,
      `${medicine.cnk};TWIN;;1`,
      `${medicine.cnk};;;1`,
      `${medicine.cnk};SOLO;;1`,
      `${medicine.cnk};SOLO;2099-12-31;1`,
      "9999999;SOLO;;1",
      `${device.cnk};;;1`,
      `${medicine.cnk};TWIN;2099-06-30;1`,
    ].join("\n");
    const before = (
      await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM inventory.reconciliations`
    )[0]?.n;
    expect(await fieldsOf(startReconciliationFromFile({ csv }, owner))).toEqual({
      code: "inventory.reconciliation_invalid",
      fields: [
        { path: "line.1", code: "inventory.lot_unknown" },
        { path: "line.2", code: "inventory.lot_ambiguous" },
        { path: "line.3", code: "inventory.lot_required" },
        { path: "line.5", code: "inventory.duplicate_lot" },
        { path: "line.6", code: "inventory.unknown_cnk" },
        // a device that never had stock has no untracked lot: receive it first
        { path: "line.7", code: "inventory.lot_unknown" },
      ],
    });
    expect(
      (
        await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM inventory.reconciliations`
      )[0]?.n,
    ).toBe(before);
  });
});

describe("typed counts, discard and permissions", () => {
  it("counts one product's lots from its page; a lot of another product is refused", async () => {
    const p = await product();
    const a = await receive(p.id, 4, "TY-A");
    const b = await receive(p.id, 1, "TY-B");
    const other = await receive((await product(false)).id, 3);
    expect(
      await codeOf(
        startReconciliation({ productId: p.id, lines: [{ lotId: other, counted: 1 }] }, owner),
      ),
    ).toBe("inventory.lot_not_found");
    const started = await startReconciliation(
      {
        productId: p.id,
        lines: [
          { lotId: a, counted: 4 },
          { lotId: b, counted: 0 },
        ],
      },
      pharmacist,
    );
    expect(started).toMatchObject({ lines: 2, differing: 1 });
    expect(
      (await getReconciliation({ reconciliationId: started.reconciliationId }, owner)).source,
    ).toBe("typed");
    await applyReconciliation({ reconciliationId: started.reconciliationId }, pharmacist);
    expect([await lotOnHand(a), await lotOnHand(b)]).toEqual([4, 0]);
  });

  it("a discarded count moves nothing and can't be applied or discarded again; audited", async () => {
    const p = await product(false);
    const lot = await receive(p.id, 5);
    const { reconciliationId } = await startReconciliationFromFile({ csv: `${p.cnk};;;1` }, owner);
    await discardReconciliation({ reconciliationId }, owner);
    expect(await codeOf(applyReconciliation({ reconciliationId }, owner))).toBe(
      "inventory.reconciliation_discarded",
    );
    expect(await codeOf(discardReconciliation({ reconciliationId }, owner))).toBe(
      "inventory.reconciliation_not_open",
    );
    expect(await lotOnHand(lot)).toBe(5);
    expect((await audited(reconciliationId)).map((e) => e.action)).toEqual([
      "inventory.reconciliation.started",
      "inventory.reconciliation.discarded",
    ]);
    expect(
      (await listOpenReconciliations({}, owner)).some(
        (r) => r.reconciliationId === reconciliationId,
      ),
    ).toBe(false);
    expect(await codeOf(getReconciliation({ reconciliationId: randomUUID() }, owner))).toBe(
      "inventory.reconciliation_not_found",
    );
  });

  it("is staff stock work: a content editor and the checkout can't count", async () => {
    const p = await product(false);
    await receive(p.id, 1);
    for (const actor of [editor, checkout]) {
      expect(await codeOf(startReconciliationFromFile({ csv: `${p.cnk};;;1` }, actor))).toBe(
        "kernel.forbidden",
      );
      expect(await codeOf(listOpenReconciliations({}, actor))).toBe("kernel.forbidden");
    }
  });
});

describe("orders and the guard", () => {
  it("an order whose lot is counted down is allocated again from the next lot", async () => {
    const p = await product();
    const soon = await receive(p.id, 2, "AL-SOON", "2098-01-31");
    const later = await receive(p.id, 4, "AL-LATER");
    const holderRef = `checkout:${newId()}`;
    await reserveStock({ productId: p.id, quantity: 2, holderRef }, checkout);
    await confirmReservation({ holderRef, items: [{ productId: p.id, quantity: 2 }] }, checkout);
    const lotsOf = async () =>
      ((await listHolderAllocations({ holderRef }, owner))[0]?.lots ?? []).map((l) => [
        l.lotId,
        l.quantity,
      ]);
    expect(await lotsOf()).toEqual([[soon, 2]]);
    const { reconciliationId } = await startReconciliationFromFile(
      { csv: `${p.cnk};AL-SOON;;0` },
      owner,
    );
    await applyReconciliation({ reconciliationId }, owner);
    expect(await lotsOf()).toEqual([[later, 2]]);
  });

  it("an ended reconciliation keeps its status and its lines can't change", async () => {
    const p = await product(false);
    await receive(p.id, 3);
    const { reconciliationId } = await startReconciliationFromFile({ csv: `${p.cnk};;;3` }, owner);
    await applyReconciliation({ reconciliationId }, owner);
    expect(
      await raw(
        () =>
          iso.sql`UPDATE inventory.reconciliations SET status = 'discarded' WHERE id = ${reconciliationId}`,
      ),
    ).toContain("cannot change");
    expect(
      await raw(
        () =>
          iso.sql`UPDATE inventory.reconciliation_lines SET counted = 9 WHERE reconciliation_id = ${reconciliationId}`,
      ),
    ).not.toBe("ok");
    expect(
      await raw(
        () => iso.sql`DELETE FROM inventory.reconciliations WHERE id = ${reconciliationId}`,
      ),
    ).not.toBe("ok");
  });
});
