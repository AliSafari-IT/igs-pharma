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
  adjustStock,
  getAvailability,
  getStock,
  importStock,
  listStock,
  previewStockImport,
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

/** A catalog product with Dutch content; returns its id and CNK. */
async function newProduct(): Promise<{ id: string; cnk: string }> {
  const cnk = String(nextCnk++);
  const { productId } = await createProductRegulated(
    {
      cnk,
      productType: "otc_medicine",
      legalStatus: "otc",
      vatClass: "BE_6",
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

const movementCount = async () =>
  (await iso.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM inventory.stock_movements`)[0]?.n;

describe("ledger", () => {
  it("on-hand is the sum of the movements", async () => {
    const p = await newProduct();
    expect(await onHand(p.id)).toBe(0);
    await importStock({ csv: `${p.cnk};10` }, owner);
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
    await importStock({ csv: `${p.cnk};2` }, owner);
    await expect(
      iso.sql`UPDATE inventory.stock_movements SET delta = 5 WHERE product_id = ${p.id}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      iso.sql`DELETE FROM inventory.stock_movements WHERE product_id = ${p.id}`,
    ).rejects.toThrow(/append-only/);
  });
});

describe("inventory.stock.import", () => {
  it("sets absolute counts, writing only the changes, and audits counts only", async () => {
    const a = await newProduct();
    const b = await newProduct();
    await importStock({ csv: `${a.cnk};4` }, owner);
    const result = await importStock({ csv: `cnk;quantity\n${a.cnk};4\n${b.cnk};7` }, owner);
    expect(result).toMatchObject({ rows: 2, changed: 1 });
    expect(await onHand(a.id)).toBe(4);
    expect(await onHand(b.id)).toBe(7);
    const events = await iso.sql<{ action: string; data: Record<string, unknown> }[]>`
      SELECT action, data FROM audit.events WHERE entity_id = ${result.importId}`;
    expect(events).toEqual([
      {
        action: "inventory.stock.imported",
        data: { importId: result.importId, rows: 2, changed: 1 },
      },
    ]);
  });

  it("applies nothing when any CNK is unknown, and lists every bad line", async () => {
    const a = await newProduct();
    const before = await movementCount();
    const outcome = await fieldsOf(
      importStock({ csv: `${a.cnk};5\n9999990;1\nbad\n9999991;2` }, owner),
    );
    expect(outcome).toEqual({
      code: "inventory.import_invalid",
      fields: [
        { path: "line.2", code: "inventory.unknown_cnk" },
        { path: "line.3", code: "inventory.row_malformed" },
        { path: "line.4", code: "inventory.unknown_cnk" },
      ],
    });
    expect(await movementCount()).toBe(before);
    expect(await onHand(a.id)).toBe(0);
  });

  it("replays a re-upload of the same file instead of importing it twice", async () => {
    const a = await newProduct();
    const csv = `${a.cnk};6`;
    const first = await importStock({ csv }, owner, { idempotencyKey: stockImportKey(csv) });
    // stock moves in between: replaying the same file must not reset it
    await adjustStock({ productId: a.id, delta: -2, reason: "adjustment", note: "sold" }, owner);
    const again = await importStock({ csv }, owner, { idempotencyKey: stockImportKey(csv) });
    expect(again).toEqual(first);
    expect(await onHand(a.id)).toBe(4);
    const imports = await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM inventory.stock_movements
      WHERE product_id = ${a.id} AND reason = 'import'`;
    expect(imports[0]?.n).toBe(1);
  });

  it("previews without writing", async () => {
    const a = await newProduct();
    await importStock({ csv: `${a.cnk};3` }, owner);
    const before = await movementCount();
    const plan = await previewStockImport({ csv: `${a.cnk};8\n9999992;1` }, owner);
    expect(plan.rows).toEqual([
      expect.objectContaining({ cnk: a.cnk, productId: a.id, onHand: 3, target: 8, delta: 5 }),
    ]);
    expect(plan.errors).toEqual([{ line: 2, code: "inventory.unknown_cnk" }]);
    expect(await movementCount()).toBe(before);
  });
});

describe("inventory.stock.adjust", () => {
  it("refuses to take stock below zero", async () => {
    const a = await newProduct();
    await importStock({ csv: `${a.cnk};2` }, owner);
    const before = await movementCount();
    expect(
      await codeOf(
        adjustStock({ productId: a.id, delta: -3, reason: "adjustment", note: "lost" }, owner),
      ),
    ).toBe("inventory.negative_stock");
    expect(await movementCount()).toBe(before);
    expect(await onHand(a.id)).toBe(2);
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
    const { movementId } = await adjustStock(
      { productId: a.id, delta: 5, reason: "correction", note: "Private remark" },
      assistant,
    );
    const events = await iso.sql<{ action: string; data: Record<string, unknown> }[]>`
      SELECT action, data FROM audit.events
      WHERE entity_id = ${a.id} AND action LIKE 'inventory.%'`;
    expect(events).toEqual([
      {
        action: "inventory.stock.adjusted",
        data: { movementId, productId: a.id, delta: 5, reason: "correction" },
      },
    ]);
  });
});

describe("inventory.stock.list", () => {
  it("lists products by CNK with on-hand and last movement, searchable", async () => {
    const a = await newProduct();
    const b = await newProduct();
    await importStock({ csv: `${a.cnk};9` }, owner);
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
    expect(await codeOf(previewStockImport({ csv: `${a.cnk};1` }, editor))).toBe(
      "kernel.forbidden",
    );
    expect(await codeOf(importStock({ csv: `${a.cnk};1` }, editor))).toBe("kernel.forbidden");
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
    await adjustStock(
      { productId: stocked.id, delta: 7, reason: "adjustment", note: "found" },
      owner,
    );
    await adjustStock({ productId: sold.id, delta: 2, reason: "adjustment", note: "found" }, owner);
    await adjustStock(
      { productId: sold.id, delta: -2, reason: "adjustment", note: "sold out" },
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
    for (const id of [rx, rxType, draft]) {
      await adjustStock({ productId: id, delta: 3, reason: "adjustment", note: "found" }, owner);
    }
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
