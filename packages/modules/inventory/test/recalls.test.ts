// Recalls, part 1 (igs-pharma#187, REQ-SAF-01) against real Postgres: starting one quarantines its
// lots and stops the product selling, only a pharmacist starts or ends it, a recalled lot stays out of
// sale, ending lifts the stop, and the database keeps the record.
import { randomUUID } from "node:crypto";

import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { type Actor, isDomainError } from "@igs/kernel";
import { type KernelTestHandles, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import {
  createProductRegulated,
  registerAuditActions as registerCatalogAudit,
  setProductStatusRegulated,
  storefrontVisibleIds,
} from "@igs/module-catalog";
import { loadRbacCatalogue } from "@igs/module-identity";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  endRecall,
  getRecall,
  getStock,
  listRecalls,
  quarantineLot,
  receiveStock,
  registerAuditActions,
  releaseLot,
  startRecall,
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
const assistant = staff("pharmacy_assistant");

let nextCnk = 9_700_100;

/** An active medicine with two lots of 5 (A1, A2). */
async function recallable(): Promise<{ productId: string; a1: string; a2: string }> {
  const cnk = String(nextCnk++);
  const { productId } = await createProductRegulated(
    {
      cnk,
      productType: "otc_medicine",
      legalStatus: "otc",
      vatClass: "BE_6",
      approveContent: true,
      content: [
        { locale: "nl", name: `Recall ${cnk}` },
        { locale: "fr", name: `Recall ${cnk} FR` },
      ],
    },
    pharmacist,
  );
  await setProductStatusRegulated({ productId, status: "active" }, pharmacist);
  const expiry = addDays(brusselsToday(kernel.clock.now()), 200);
  const receive = (lotNumber: string) =>
    receiveStock({ productId, quantity: 5, lotNumber, expiryDate: expiry }, assistant);
  const { lotId: a1 } = await receive("A1");
  const { lotId: a2 } = await receive("A2");
  return { productId, a1, a2 };
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

const visible = async (productId: string) =>
  (await iso.db.transaction((tx) => storefrontVisibleIds(tx, [productId]))).length === 1;

const lotsBy = async (productId: string) =>
  new Map((await getStock({ productId }, pharmacist)).lots.map((lot) => [lot.lotId, lot]));

const actions = async (productId: string) =>
  (
    await iso.sql<{ action: string; data: Record<string, unknown> }[]>`
      SELECT action, data FROM audit.events WHERE entity_id = ${productId} ORDER BY seq`
  ).filter(
    (row) =>
      row.action.includes("recall") ||
      row.action.includes("sale_") ||
      row.action.includes("quarantined"),
  );

describe("starting a recall", () => {
  it("quarantines the named lots and stops the product selling", async () => {
    const { productId, a1, a2 } = await recallable();
    expect(await visible(productId)).toBe(true);
    const started = await startRecall(
      { productId, lotIds: [a1], source: "famhp", note: "FAMHP notice 2026-123" },
      pharmacist,
    );
    expect(started).toMatchObject({ lots: 1, quarantined: 1 });

    const lots = await lotsBy(productId);
    expect(lots.get(a1)?.quarantine?.reason).toBe("recall");
    expect(lots.get(a2)?.quarantine).toBeNull();
    // the stop-sale: the product leaves the storefront (and so checkout and fulfilment, #182)
    expect(await visible(productId)).toBe(false);
    expect((await getStock({ productId }, pharmacist)).activeRecallId).toBe(started.recallId);

    const recall = await getRecall({ recallId: started.recallId }, pharmacist);
    expect(recall).toMatchObject({
      productId,
      scope: "lots",
      source: "famhp",
      note: "FAMHP notice 2026-123",
      lotCount: 1,
      endedAt: null,
    });
    expect(recall.lots.map((lot) => lot.lotId)).toEqual([a1]);

    const audit = await actions(productId);
    expect(audit.map((row) => row.action)).toEqual([
      "inventory.lot.quarantined",
      "catalog.product.sale_stopped",
      "inventory.recall.started",
    ]);
    // ids, the scope, the source and counts: never the note
    expect(audit[2]?.data).toEqual({
      recallId: started.recallId,
      productId,
      scope: "lots",
      source: "famhp",
      lots: 1,
      quarantined: 1,
    });
  });

  it("covers every lot without named lots; a lot already quarantined keeps its reason", async () => {
    const { productId, a1, a2 } = await recallable();
    await quarantineLot({ lotId: a2, reason: "damaged" }, pharmacist);
    const started = await startRecall(
      { productId, source: "manufacturer", note: "Batch contamination" },
      titular,
    );
    expect(started).toMatchObject({ lots: 2, quarantined: 1 });
    const lots = await lotsBy(productId);
    expect(lots.get(a1)?.quarantine?.reason).toBe("recall");
    expect(lots.get(a2)?.quarantine?.reason).toBe("damaged");
    expect((await getStock({ productId }, pharmacist)).sellable).toBe(0);
    expect((await getRecall({ recallId: started.recallId }, pharmacist)).scope).toBe("all_lots");
  });

  it("is a pharmacist's act only", async () => {
    const { productId } = await recallable();
    for (const actor of [owner, assistant]) {
      expect(await codeOf(startRecall({ productId, source: "pharmacy", note: "x" }, actor))).toBe(
        "kernel.forbidden",
      );
    }
    expect(await visible(productId)).toBe(true);
  });

  it("refuses a second active recall, another product's lot, and an unknown product", async () => {
    const one = await recallable();
    const other = await recallable();
    expect(
      await codeOf(
        startRecall(
          { productId: one.productId, lotIds: [other.a1], source: "pharmacy", note: "x" },
          pharmacist,
        ),
      ),
    ).toBe("inventory.lot_not_found");
    expect(
      await codeOf(
        startRecall({ productId: randomUUID(), source: "pharmacy", note: "x" }, pharmacist),
      ),
    ).toBe("inventory.product_not_found");
    await startRecall({ productId: one.productId, source: "pharmacy", note: "x" }, pharmacist);
    expect(
      await codeOf(
        startRecall({ productId: one.productId, source: "famhp", note: "again" }, pharmacist),
      ),
    ).toBe("inventory.recall_active");
    // nothing of the refused attempts was kept
    expect((await lotsBy(other.productId)).get(other.a1)?.quarantine).toBeNull();
    expect(await visible(other.productId)).toBe(true);
  });
});

describe("a recalled lot", () => {
  it("cannot be released while its recall is active", async () => {
    const { productId, a1 } = await recallable();
    const { recallId } = await startRecall(
      { productId, lotIds: [a1], source: "wholesaler", note: "x" },
      pharmacist,
    );
    expect(await codeOf(releaseLot({ lotId: a1 }, pharmacist))).toBe("inventory.lot_under_recall");
    await endRecall({ recallId }, pharmacist);
    // the lot stays quarantined after the recall (its disposal is part 2) until a pharmacist releases it
    expect((await lotsBy(productId)).get(a1)?.quarantine?.reason).toBe("recall");
    expect(await codeOf(releaseLot({ lotId: a1 }, pharmacist))).toBe("ok");
  });
});

describe("ending a recall", () => {
  it("lifts the stop-sale; only a pharmacist ends it, once", async () => {
    const { productId } = await recallable();
    const { recallId } = await startRecall({ productId, source: "famhp", note: "x" }, pharmacist);
    for (const actor of [owner, assistant]) {
      expect(await codeOf(endRecall({ recallId }, actor))).toBe("kernel.forbidden");
    }
    expect(await visible(productId)).toBe(false);

    await endRecall({ recallId }, titular);
    expect(await visible(productId)).toBe(true);
    expect((await getStock({ productId }, pharmacist)).activeRecallId).toBeNull();
    expect(await codeOf(endRecall({ recallId }, pharmacist))).toBe("inventory.recall_ended");
    expect(await codeOf(endRecall({ recallId: randomUUID() }, pharmacist))).toBe(
      "inventory.recall_not_found",
    );
    expect((await actions(productId)).slice(-2).map((row) => row.action)).toEqual([
      "catalog.product.sale_resumed",
      "inventory.recall.ended",
    ]);

    // a new recall may start once the last one ended
    expect(
      await codeOf(startRecall({ productId, source: "pharmacy", note: "again" }, pharmacist)),
    ).toBe("ok");
  });

  it("lists active recalls first", async () => {
    const ended = await recallable();
    const active = await recallable();
    const first = await startRecall(
      { productId: ended.productId, source: "famhp", note: "x" },
      pharmacist,
    );
    await endRecall({ recallId: first.recallId }, pharmacist);
    const second = await startRecall(
      { productId: active.productId, source: "famhp", note: "x" },
      pharmacist,
    );
    const list = await listRecalls({}, assistant);
    const ids = list.map((row) => row.recallId);
    expect(ids.indexOf(second.recallId)).toBeLessThan(ids.indexOf(first.recallId));
    expect(list.find((row) => row.recallId === second.recallId)).toMatchObject({
      productId: active.productId,
      lotCount: 2,
      endedAt: null,
    });
  });
});

describe("the database keeps the record", () => {
  it("refuses changing a recall or a stop-sale, ending one twice, and deleting either", async () => {
    const { productId } = await recallable();
    const { recallId } = await startRecall(
      { productId, source: "famhp", note: "kept" },
      pharmacist,
    );
    await expect(
      iso.sql`UPDATE inventory.recalls SET note = 'changed' WHERE id = ${recallId}`,
    ).rejects.toThrow(/keeps/);
    await expect(iso.sql`DELETE FROM inventory.recalls WHERE id = ${recallId}`).rejects.toThrow();
    await expect(
      iso.sql`DELETE FROM inventory.recall_lots WHERE recall_id = ${recallId}`,
    ).rejects.toThrow();
    await expect(
      iso.sql`UPDATE catalog.stop_sales SET product_id = product_id, reason = 'recall', reference_id = ${randomUUID()} WHERE reference_id = ${recallId}`,
    ).rejects.toThrow(/keeps/);
    await expect(
      iso.sql`DELETE FROM catalog.stop_sales WHERE reference_id = ${recallId}`,
    ).rejects.toThrow(/kept/);

    await endRecall({ recallId }, pharmacist);
    await expect(
      iso.sql`UPDATE inventory.recalls SET ended_at = now() WHERE id = ${recallId}`,
    ).rejects.toThrow(/ended/);
    await expect(
      iso.sql`UPDATE catalog.stop_sales SET ended_at = now() WHERE reference_id = ${recallId}`,
    ).rejects.toThrow(/ended/);
  });
});
