// Inventory commands and queries (igs-pharma#53) against real Postgres, with the RBAC catalogue
// loaded from the database and the real audit port, so permissions and audit shapes are exercised.
import { randomUUID } from "node:crypto";

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
  IMPORT_PLAN_TTL_MS,
  adjustStock,
  getAvailability,
  getStock,
  importStock,
  listStock,
  prepareStockImport,
  receiveStock,
  registerAuditActions,
  stockImportKey,
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
  kernel.clock.set(new Date()); // audit partitions exist around "now"
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

let nextCnk = 9_800_100;

/**
 * A catalog product with Dutch content; returns its id and CNK. Not a medicine: its stock sits in
 * its `no_lot` lot, so these tests exercise the ledger itself (lots: lots.test.ts).
 */
async function newProduct(): Promise<{ id: string; cnk: string }> {
  const cnk = String(nextCnk++);
  const { productId } = await createProductRegulated(
    {
      cnk,
      productType: "medical_device",
      legalStatus: "general_sale",
      vatClass: "BE_21",
      content: [{ locale: "nl", name: `Demo ${cnk}` }],
    },
    pharmacist,
  );
  return { id: productId, cnk };
}

/** An ACTIVE catalog product (the storefront only knows active ones), optionally prescription-only. */
async function storefrontProduct(
  legalStatus: "otc" | "pharmacy_only" | "rx" = "otc",
  productType: "otc_medicine" | "rx_medicine" = "otc_medicine",
): Promise<string> {
  const cnk = String(nextCnk++);
  // created consistent (the command refuses a type/status mismatch, #79); a row from before that
  // rule, which the D-034 tests need, is written directly
  const { productId } = await createProductRegulated(
    {
      cnk,
      productType: "otc_medicine",
      legalStatus: "otc",
      vatClass: "BE_6",
      approveContent: true, // a medicine is storefront-visible only with pharmacist-approved text (#103)
      content: [
        { locale: "nl", name: `Demo ${cnk}` },
        { locale: "fr", name: `Demo ${cnk} FR` },
      ],
    },
    pharmacist,
  );
  if (productType !== "otc_medicine" || legalStatus !== "otc") {
    await iso.sql`
      UPDATE catalog.products SET product_type = ${productType}, legal_status = ${legalStatus}
      WHERE id = ${productId}`;
  }
  await setProductStatusRegulated({ productId, status: "active" }, pharmacist);
  return productId;
}

/** Stock received into a lot of a medicine (a medicine's stock is always in a real lot, #164). */
const receiveLot = (productId: string, quantity: number) =>
  receiveStock({ productId, quantity, lotNumber: "TEST-1", expiryDate: "2099-12-31" }, owner);

/** The two-step import of a file: preview (a new plan) then confirm that plan. */
async function importCsv(csv: string, actor: Actor = owner) {
  const prepared = await prepareStockImport({ csv }, actor);
  return importStock({ planId: prepared.planId }, actor);
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

const onHand = async (productId: string) => (await getStock({ productId }, pharmacist)).onHand;

const planCount = async () =>
  (await iso.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM inventory.import_plans`)[0]?.n;

const movementCount = async () =>
  (await iso.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM inventory.stock_movements`)[0]?.n;

describe("ledger", () => {
  it("on-hand is the sum of the movements", async () => {
    const p = await newProduct();
    expect(await onHand(p.id)).toBe(0);
    await importCsv(`${p.cnk};10`);
    await adjustStock({ productId: p.id, delta: -3, reason: "adjustment", note: "broken" }, owner);
    await adjustStock(
      { productId: p.id, delta: 1, reason: "correction", note: "miscounted" },
      owner,
    );
    const stock = await getStock({ productId: p.id }, pharmacist);
    expect(stock.onHand).toBe(8);
    expect(stock.movements.map((m) => [m.delta, m.reason])).toEqual([
      [1, "correction"],
      [-3, "adjustment"],
      [10, "import"],
    ]);
    const [sum] = await iso.sql<{ total: number }[]>`
      SELECT sum(delta)::int AS total FROM inventory.stock_movements WHERE product_id = ${p.id}`;
    expect(sum?.total).toBe(8);
  });

  it("refuses to change or remove a movement", async () => {
    const p = await newProduct();
    await importCsv(`${p.cnk};2`);
    await expect(
      iso.sql`UPDATE inventory.stock_movements SET delta = 5 WHERE product_id = ${p.id}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      iso.sql`DELETE FROM inventory.stock_movements WHERE product_id = ${p.id}`,
    ).rejects.toThrow(/append-only/);
    // #91: emptying the whole ledger at once is refused too (a statement-level trigger)
    await expect(iso.sql`TRUNCATE inventory.stock_movements`).rejects.toThrow(/append-only/);
  });
});

describe("inventory.stock.import", () => {
  it("sets absolute counts, writing only the changes, and audits counts only", async () => {
    const a = await newProduct();
    const b = await newProduct();
    await importCsv(`${a.cnk};4`);
    const result = await importCsv(`cnk;quantity\n${a.cnk};4\n${b.cnk};7`);
    expect(result).toMatchObject({ rows: 2, changed: 1 });
    expect(await onHand(a.id)).toBe(4);
    expect(await onHand(b.id)).toBe(7);
    const events = await iso.sql<{ action: string; data: Record<string, unknown> }[]>`
      SELECT action, data FROM audit.events WHERE entity_id = ${result.importId} ORDER BY action`;
    // the preview and the confirm of one submission share its id (the plan id)
    expect(events).toEqual([
      {
        action: "inventory.stock.import_prepared",
        data: { planId: result.importId, rows: 2 },
      },
      {
        action: "inventory.stock.imported",
        data: { importId: result.importId, rows: 2, changed: 1 },
      },
    ]);
  });

  it("stores no plan and lists every bad line when the file has problems", async () => {
    const a = await newProduct();
    const movements = await movementCount();
    const plans = await planCount();
    const outcome = await fieldsOf(
      prepareStockImport({ csv: `${a.cnk};5\n9999990;1\nbad\n9999991;2` }, owner),
    );
    expect(outcome).toEqual({
      code: "inventory.import_invalid",
      fields: [
        { path: "line.2", code: "inventory.unknown_cnk" },
        { path: "line.3", code: "inventory.row_malformed" },
        { path: "line.4", code: "inventory.unknown_cnk" },
      ],
    });
    expect(await movementCount()).toBe(movements);
    expect(await planCount()).toBe(plans);
    expect(await onHand(a.id)).toBe(0);
  });

  it("D4: the same file previewed again after the stock moved imports again (a new submission)", async () => {
    const a = await newProduct();
    const csv = `${a.cnk};6`;
    await importCsv(csv);
    await adjustStock({ productId: a.id, delta: -6, reason: "adjustment", note: "sold" }, owner);
    expect(await onHand(a.id)).toBe(0);
    const again = await importCsv(csv);
    expect(again.changed).toBe(1);
    expect(await onHand(a.id)).toBe(6);
  });

  it("D4: a double click on ONE confirm replays instead of importing twice", async () => {
    const a = await newProduct();
    const { planId } = await prepareStockImport({ csv: `${a.cnk};6` }, owner);
    const key = { idempotencyKey: stockImportKey(planId) };
    const [first, second] = await Promise.all([
      importStock({ planId: planId }, owner, key),
      importStock({ planId: planId }, owner, key),
    ]);
    expect(second).toEqual(first);
    await adjustStock({ productId: a.id, delta: -2, reason: "adjustment", note: "sold" }, owner);
    // a later replay of the same confirm must not reset the stock
    expect(await importStock({ planId: planId }, owner, key)).toEqual(first);
    expect(await onHand(a.id)).toBe(4);
    const imports = await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM inventory.stock_movements
      WHERE product_id = ${a.id} AND reason = 'import'`;
    expect(imports[0]?.n).toBe(1);
  });

  it("D5: stock that moved between preview and confirm refuses the whole import, writing nothing", async () => {
    const a = await newProduct();
    const b = await newProduct();
    const c = await newProduct();
    await importCsv(`${a.cnk};5\n${b.cnk};5\n${c.cnk};5`);
    const { planId } = await prepareStockImport(
      { csv: `${a.cnk};9\n${b.cnk};1\n${c.cnk};5` },
      owner,
    );
    // between preview and confirm: a changes, c (unchanged by the file) also changes
    await adjustStock({ productId: a.id, delta: -1, reason: "adjustment", note: "sold" }, owner);
    await adjustStock({ productId: c.id, delta: 2, reason: "correction", note: "found" }, owner);
    const before = await movementCount();
    let refusal: { code: string; details?: unknown } | undefined;
    try {
      await importStock({ planId: planId }, owner);
    } catch (error) {
      if (!isDomainError(error)) throw error;
      refusal = { code: error.code, details: error.details };
    }
    expect(refusal).toEqual({ code: "inventory.import_stale", details: { changedRows: 2 } });
    expect(await movementCount()).toBe(before);
    expect(await onHand(a.id)).toBe(4);
    expect(await onHand(b.id)).toBe(5); // b would have been 1: nothing of the import was applied
    expect(await onHand(c.id)).toBe(7);
  });

  it("D5: writes exactly what the preview showed when nothing moved", async () => {
    const a = await newProduct();
    const b = await newProduct();
    await importCsv(`${a.cnk};5`);
    const prepared = await prepareStockImport({ csv: `${a.cnk};9\n${b.cnk};3` }, owner);
    expect(prepared.rows.map((r) => [r.cnk, r.onHand, r.target, r.delta])).toEqual([
      [a.cnk, 5, 9, 4],
      [b.cnk, 0, 3, 3],
    ]);
    const result = await importStock({ planId: prepared.planId }, owner);
    expect(result).toMatchObject({ rows: 2, changed: 2 });
    const rows = await iso.sql<{ product_id: string; delta: number }[]>`
      SELECT product_id, delta FROM inventory.stock_movements
      WHERE import_id = ${result.importId} ORDER BY delta`;
    expect(rows.map((r) => r.delta)).toEqual([3, 4]);
  });

  it("a plan belongs to its preparer, expires after an hour and stores no personal data", async () => {
    const a = await newProduct();
    const { planId } = await prepareStockImport({ csv: `${a.cnk};2` }, owner);
    const other = staff("owner");
    expect(await codeOf(importStock({ planId: planId }, other))).toBe(
      "inventory.import_plan_not_found",
    );
    expect(await codeOf(importStock({ planId: randomUUID() }, owner))).toBe(
      "inventory.import_plan_not_found",
    );
    const [row] = await iso.sql<{ rows: unknown; ttl_ms: number }[]>`
      SELECT rows, (extract(epoch FROM expires_at - created_at) * 1000)::int AS ttl_ms
      FROM inventory.import_plans WHERE id = ${planId}`;
    expect(row?.ttl_ms).toBe(IMPORT_PLAN_TTL_MS);
    expect(row?.rows).toEqual([{ productId: a.id, cnk: a.cnk, expectedOnHand: 0, target: 2 }]);
    kernel.clock.set(new Date(Date.now() + IMPORT_PLAN_TTL_MS + 1_000));
    expect(await codeOf(importStock({ planId: planId }, owner))).toBe(
      "inventory.import_plan_expired",
    );
    expect(await onHand(a.id)).toBe(0);
  });

  it("previews without writing stock, and audits the preparation with ids and counts only", async () => {
    const a = await newProduct();
    await importCsv(`${a.cnk};3`);
    const before = await movementCount();
    const ok = await prepareStockImport({ csv: `${a.cnk};8` }, owner);
    expect(ok.rows).toEqual([
      expect.objectContaining({ cnk: a.cnk, productId: a.id, onHand: 3, target: 8, delta: 5 }),
    ]);
    expect(await movementCount()).toBe(before);
    const events = await iso.sql<{ action: string; data: Record<string, unknown> }[]>`
      SELECT action, data FROM audit.events WHERE entity_id = ${ok.planId}`;
    expect(events).toEqual([
      {
        action: "inventory.stock.import_prepared",
        data: { planId: ok.planId, rows: 1 },
      },
    ]);
  });
});

describe("inventory.stock.adjust", () => {
  it("refuses to take stock below zero", async () => {
    const a = await newProduct();
    await importCsv(`${a.cnk};2`);
    const before = await movementCount();
    expect(
      await codeOf(
        adjustStock({ productId: a.id, delta: -3, reason: "adjustment", note: "lost" }, owner),
      ),
    ).toBe("inventory.negative_stock");
    expect(await movementCount()).toBe(before);
    expect(await onHand(a.id)).toBe(2);
  });

  it("parallel adjustments: exactly as many succeed as there is stock", async () => {
    const a = await newProduct();
    await importCsv(`${a.cnk};5`);
    const outcomes = await Promise.all(
      Array.from({ length: 12 }, () =>
        codeOf(
          adjustStock({ productId: a.id, delta: -1, reason: "adjustment", note: "sold" }, owner),
        ),
      ),
    );
    expect(outcomes.filter((o) => o === "ok")).toHaveLength(5);
    expect(outcomes.filter((o) => o === "inventory.negative_stock")).toHaveLength(7);
    expect(await onHand(a.id)).toBe(0);
  });

  it("a lost race against a writer that skips the lock still gives the typed error", async () => {
    const a = await newProduct();
    await importCsv(`${a.cnk};5`);
    // a raw writer holds the product's level row (uncommitted -5); the pre-check of the adjustment
    // still sees 5 and passes, the database then refuses the movement once the raw writer commits
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => {};
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const raw = iso.sql.begin(async (tx) => {
      await tx`
        INSERT INTO inventory.stock_movements (id, product_id, location_id, lot_id, delta, reason, actor_type, actor_id)
        VALUES (${randomUUID()}, ${a.id}, ${DEFAULT_LOCATION_ID},
          (SELECT id FROM inventory.lots WHERE product_id = ${a.id} AND tracking = 'no_lot'),
          -5, 'adjustment', 'system', 'test')`;
      locked();
      await held;
    });
    await isLocked;
    const adjusting = codeOf(
      adjustStock({ productId: a.id, delta: -3, reason: "adjustment", note: "sold" }, owner),
    );
    await new Promise((resolve) => setTimeout(resolve, 300)); // let it reach the blocked insert
    release();
    await raw;
    expect(await adjusting).toBe("inventory.negative_stock");
    expect(await onHand(a.id)).toBe(0);
  });

  it("requires a reason and a note, and refuses a zero delta", async () => {
    const a = await newProduct();
    const base = { productId: a.id, delta: 1, reason: "adjustment", note: "found" };
    expect(await codeOf(adjustStock({ ...base, note: " " }, owner))).toBe(
      "kernel.validation_failed",
    );
    expect(await codeOf(adjustStock({ ...base, reason: "import" }, owner))).toBe(
      "kernel.validation_failed",
    );
    expect(await codeOf(adjustStock({ ...base, delta: 0 }, owner))).toBe(
      "kernel.validation_failed",
    );
  });

  it("refuses an unknown product", async () => {
    expect(
      await codeOf(
        adjustStock({ productId: randomUUID(), delta: 1, reason: "adjustment", note: "x" }, owner),
      ),
    ).toBe("inventory.product_not_found");
  });

  it("audits identifiers and the delta, never the note", async () => {
    const a = await newProduct();
    const { movementId, lotId } = await adjustStock(
      { productId: a.id, delta: 5, reason: "correction", note: "Private remark" },
      assistant,
    );
    const events = await iso.sql<{ action: string; data: Record<string, unknown> }[]>`
      SELECT action, data FROM audit.events
      WHERE entity_id = ${a.id} AND action LIKE 'inventory.%'`;
    expect(events).toEqual([
      {
        action: "inventory.stock.adjusted",
        data: { movementId, productId: a.id, lotId, delta: 5, reason: "correction" },
      },
    ]);
  });
});

describe("inventory.stock.list", () => {
  it("lists products by CNK with on-hand and last movement, searchable", async () => {
    const a = await newProduct();
    const b = await newProduct();
    await importCsv(`${a.cnk};9`);
    const page = await listStock({ q: a.cnk.slice(0, 5), pageSize: 100 }, pharmacist);
    const mine = page.items.filter((i) => i.productId === a.id || i.productId === b.id);
    expect(mine).toEqual([
      expect.objectContaining({ cnk: a.cnk, onHand: 9, lastMovementAt: expect.any(Date) }),
      expect.objectContaining({ cnk: b.cnk, onHand: 0, lastMovementAt: null }),
    ]);
    const byName = await listStock({ q: `Demo ${b.cnk}` }, pharmacist);
    expect(byName.items.map((i) => i.productId)).toEqual([b.id]);
  });
});

describe("permissions", () => {
  it("lets pharmacists, assistants and the owner read and manage stock", async () => {
    const a = await newProduct();
    for (const actor of [owner, pharmacist, assistant]) {
      expect(await codeOf(listStock({}, actor))).toBe("ok");
      expect(
        await codeOf(
          adjustStock({ productId: a.id, delta: 1, reason: "adjustment", note: "n" }, actor),
        ),
      ).toBe("ok");
    }
  });

  it("keeps a content editor out", async () => {
    const a = await newProduct();
    expect(await codeOf(listStock({}, editor))).toBe("kernel.forbidden");
    expect(await codeOf(getStock({ productId: a.id }, editor))).toBe("kernel.forbidden");
    expect(await codeOf(prepareStockImport({ csv: `${a.cnk};1` }, editor))).toBe(
      "kernel.forbidden",
    );
    expect(await codeOf(importStock({ planId: randomUUID() }, editor))).toBe("kernel.forbidden");
    expect(
      await codeOf(
        adjustStock({ productId: a.id, delta: 1, reason: "adjustment", note: "n" }, editor),
      ),
    ).toBe("kernel.forbidden");
  });
});

describe("inventory.availability.get (storefront)", () => {
  const storefront: Actor = { type: "system", id: "storefront", roles: ["system_storefront"] };

  it("says in or out of stock and never how many", async () => {
    const stocked = { id: await storefrontProduct() };
    const sold = { id: await storefrontProduct("pharmacy_only") };
    const never = { id: await storefrontProduct() };
    await receiveLot(stocked.id, 7);
    const { lotId } = await receiveLot(sold.id, 2);
    await adjustStock(
      { productId: sold.id, lotId, delta: -2, reason: "adjustment", note: "sold out" },
      owner,
    );

    const rows = await getAvailability(
      { productIds: [stocked.id, sold.id, never.id, randomUUID()] },
      storefront,
    );
    expect(rows).toEqual([
      { productId: stocked.id, inStock: true },
      { productId: sold.id, inStock: false },
      { productId: never.id, inStock: false },
    ]);
    expect(JSON.stringify(rows)).not.toContain("onHand");
  });

  it("does not know a prescription, a draft or an unknown product (D-034)", async () => {
    const visible = await storefrontProduct();
    const rx = await storefrontProduct("rx");
    const rxType = await storefrontProduct("otc", "rx_medicine");
    const draft = (await newProduct()).id;
    for (const id of [rx, rxType]) await receiveLot(id, 3);
    await adjustStock({ productId: draft, delta: 3, reason: "adjustment", note: "found" }, owner);
    const ids = [rx, rxType, draft, randomUUID(), visible];
    expect(await getAvailability({ productIds: ids }, storefront)).toEqual([
      { productId: visible, inStock: false },
    ]);
    // staff still see every product
    const all = await getAvailability({ productIds: [rx, draft] }, owner);
    expect(all.map((r) => r.productId).sort()).toEqual([rx, draft].sort());
  });

  it("is a permission of its own: the storefront cannot read stock levels, staff roles without it cannot read availability", async () => {
    const item = await newProduct();
    expect(await codeOf(listStock({}, storefront))).toBe("kernel.forbidden");
    expect(await codeOf(getStock({ productId: item.id }, storefront))).toBe("kernel.forbidden");
    expect(await codeOf(getAvailability({ productIds: [item.id] }, editor))).toBe(
      "kernel.forbidden",
    );
  });
});
