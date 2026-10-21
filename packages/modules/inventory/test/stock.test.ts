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
  adjustStock,
  applyReconciliation,
  getAvailability,
  getStock,
  listStock,
  receiveStock,
  registerAuditActions,
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

/** `quantity` received into a non-medicine's untracked (`no_lot`) stock. */
const receive = (p: { readonly id: string }, quantity: number) =>
  receiveStock({ productId: p.id, quantity }, owner);

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "ok";
};

const onHand = async (productId: string) => (await getStock({ productId }, pharmacist)).onHand;

const movementCount = async () =>
  (await iso.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM inventory.stock_movements`)[0]?.n;

describe("ledger", () => {
  it("on-hand is the sum of the movements", async () => {
    const p = await newProduct();
    expect(await onHand(p.id)).toBe(0);
    await receive(p, 10);
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
      [10, "receipt"],
    ]);
    const [sum] = await iso.sql<{ total: number }[]>`
      SELECT sum(delta)::int AS total FROM inventory.stock_movements WHERE product_id = ${p.id}`;
    expect(sum?.total).toBe(8);
  });

  it("refuses to change or remove a movement", async () => {
    const p = await newProduct();
    await receive(p, 2);
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

describe("inventory.stock.adjust", () => {
  it("refuses to take stock below zero", async () => {
    const a = await newProduct();
    await receive(a, 2);
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
    await receive(a, 5);
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
    await receive(a, 5);
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
    await receive(a, 9);
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
    expect(await codeOf(startReconciliationFromFile({ csv: `${a.cnk};;;1` }, editor))).toBe(
      "kernel.forbidden",
    );
    expect(await codeOf(applyReconciliation({ reconciliationId: randomUUID() }, editor))).toBe(
      "kernel.forbidden",
    );
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
