// The synthetic catalogue seed (igs-pharma#50) and its demo stock (igs-pharma#53) against real Postgres, through the kernel as the
// seed CLI's system actor, with the RBAC catalogue loaded from the database (igs-pharma#51 review).
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { createProduct, registerAuditActions } from "@igs/module-catalog";
import { loadRbacCatalogue } from "@igs/module-identity";
import { registerAuditActions as registerInventoryAuditActions } from "@igs/module-inventory";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  BRANDS,
  CATEGORIES,
  PRODUCTS,
  SEED_ACTOR,
  cnkFor,
  demoStockFor,
  seedSyntheticCatalog,
  seedSyntheticCategories,
  seedSyntheticStock,
} from "../src/synthetic-catalog";

let iso: IsolatedDatabase;

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  registerAuditActions(registerAuditAction);
  registerInventoryAuditActions(registerAuditAction);
});
afterAll(async () => {
  await iso?.drop();
});
beforeEach(() => {
  const kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  kernel.clock.set(new Date()); // audit partitions exist around "now"
});

const statusOf = async (cnk: string) =>
  (await iso.sql<{ status: string }[]>`SELECT status FROM catalog.products WHERE cnk = ${cnk}`)[0]
    ?.status;

const firstActive = PRODUCTS.findIndex((p) => p.status === "active");
const otherActive = PRODUCTS.findIndex((p, i) => i > firstActive && p.status === "active");

describe("seedSyntheticCatalog", () => {
  // the tests share one database and run in order: a first run, a re-run, an interrupted run
  it("creates every product with its status and brand, even past 1,000 brands", async () => {
    // 1,000 brands that sort before "Demo …" push the seed brands off the full brand list
    await iso.sql`
      INSERT INTO catalog.brands (id, name, slug)
      SELECT gen_random_uuid(), 'Aa brand ' || n, 'aa-brand-' || n
      FROM generate_series(1, 1000) AS n`;
    // someone else's product on a seed CNK, in draft
    await createProduct(
      {
        cnk: cnkFor(otherActive),
        productType: "general",
        legalStatus: "general_sale",
        vatClass: "BE_21",
        content: [{ locale: "nl", name: "Niet het seedproduct" }],
      },
      SEED_ACTOR,
    );

    expect(await seedSyntheticCatalog()).toEqual({
      created: PRODUCTS.length - 1,
      restored: 0,
      skipped: 1,
    });

    for (const [index, seed] of PRODUCTS.entries()) {
      if (index === otherActive) continue;
      expect(await statusOf(cnkFor(index))).toBe(seed.status);
    }
    const rows = await iso.sql<{ cnk: string; slug: string | null }[]>`
      SELECT p.cnk, b.slug FROM catalog.products p LEFT JOIN catalog.brands b ON b.id = p.brand_id
      WHERE p.cnk BETWEEN ${cnkFor(0)} AND ${cnkFor(PRODUCTS.length - 1)}`;
    const brandOf = new Map(rows.map((r) => [r.cnk, r.slug]));
    for (const [index, seed] of PRODUCTS.entries()) {
      if (index === otherActive) continue;
      expect(brandOf.get(cnkFor(index))).toBe(seed.brand ?? null);
    }
    expect(BRANDS.some((b) => PRODUCTS.some((p) => p.brand === b.slug))).toBe(true);
  });

  it("changes nothing on a second run, and leaves the other product on a seed CNK alone", async () => {
    expect(await seedSyntheticCatalog()).toEqual({
      created: 0,
      restored: 0,
      skipped: PRODUCTS.length,
    });
    expect(await statusOf(cnkFor(otherActive))).toBe("draft");
  });

  it("gives a product left in draft by an interrupted run its intended status", async () => {
    // what a run that stopped between createProduct and setProductStatus leaves behind
    await iso.sql`UPDATE catalog.products SET status = 'draft' WHERE cnk = ${cnkFor(firstActive)}`;
    expect(await seedSyntheticCatalog()).toEqual({
      created: 0,
      restored: 1,
      skipped: PRODUCTS.length - 1,
    });
    expect(await statusOf(cnkFor(firstActive))).toBe("active");
    expect(await statusOf(cnkFor(otherActive))).toBe("draft");
  });
});

describe("seedSyntheticStock", () => {
  // runs after the catalogue tests above, on the same database
  const onHandOf = async (cnk: string) =>
    (
      await iso.sql<{ on_hand: number }[]>`
        SELECT coalesce(sum(m.delta), 0)::int AS on_hand
        FROM catalog.products p LEFT JOIN inventory.stock_movements m ON m.product_id = p.id
        WHERE p.cnk = ${cnk}`
    )[0]?.on_hand;

  it("stocks every seed product once, as audited receipts (a medicine in a lot), and leaves the other product alone", async () => {
    expect(await seedSyntheticStock()).toEqual({ stocked: PRODUCTS.length - 1, skipped: 1 });
    for (const [index] of PRODUCTS.entries()) {
      expect(await onHandOf(cnkFor(index))).toBe(index === otherActive ? 0 : demoStockFor(index));
    }
    const events = await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit.events
      WHERE action = 'inventory.stock.received' AND actor_id = ${SEED_ACTOR.id}`;
    expect(events[0]?.n).toBe(PRODUCTS.length - 1);
    // igs-pharma#164: every demo medicine's stock is in a real lot with an expiry date
    const untracked = await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM inventory.lots l JOIN catalog.products p ON p.id = l.product_id
      WHERE p.product_type IN ('otc_medicine', 'rx_medicine')
        AND (l.tracking <> 'lot' OR l.expiry_date IS NULL)`;
    expect(untracked[0]?.n).toBe(0);
  });

  it("changes nothing on a second run, even after stock moved", async () => {
    await iso.sql`
      INSERT INTO inventory.stock_movements
        (id, product_id, location_id, lot_id, delta, reason, note, actor_type, actor_id)
      SELECT gen_random_uuid(), p.id, '0192f000-0000-7000-8000-000000000001',
        (SELECT l.id FROM inventory.lots l WHERE l.product_id = p.id LIMIT 1), 5, 'correction',
        'counted again', 'user', 'someone'
      FROM catalog.products p WHERE p.cnk = ${cnkFor(0)}`;
    expect(await seedSyntheticStock()).toEqual({ stocked: 0, skipped: PRODUCTS.length });
    expect(await onHandOf(cnkFor(0))).toBe(demoStockFor(0) + 5);
  });
});

describe("seedSyntheticCategories", () => {
  // runs after the tests above, on the same database
  const categoriesOf = async (cnk: string) =>
    (
      await iso.sql<{ slug: string }[]>`
        SELECT c.slug FROM catalog.products p
        JOIN catalog.product_categories pc ON pc.product_id = p.id
        JOIN catalog.categories c ON c.id = pc.category_id
        WHERE p.cnk = ${cnk} ORDER BY c.slug`
    ).map((r) => r.slug);

  it("creates the demo tree and puts every seed product in its categories, audited", async () => {
    // a category staff made already, with a seed slug: kept as it is
    await iso.sql`
      INSERT INTO catalog.categories (id, slug, name_nl, name_fr)
      VALUES (gen_random_uuid(), 'baby', 'Baby (eigen)', 'Bébé (propre)')`;
    expect(await seedSyntheticCategories()).toEqual({
      created: CATEGORIES.length - 1,
      assigned: PRODUCTS.length - 1,
      skipped: 1,
    });
    for (const [index, seed] of PRODUCTS.entries()) {
      expect(await categoriesOf(cnkFor(index))).toEqual(
        index === otherActive ? [] : [...seed.categories].sort(),
      );
    }
    const [sun] = await iso.sql<{ parent: string }[]>`
      SELECT p.slug AS parent FROM catalog.categories c
      JOIN catalog.categories p ON p.id = c.parent_id WHERE c.slug = 'sun-care'`;
    expect(sun?.parent).toBe("skin-care");
    const [baby] = await iso.sql<{ name_nl: string }[]>`
      SELECT name_nl FROM catalog.categories WHERE slug = 'baby'`;
    expect(baby?.name_nl).toBe("Baby (eigen)");
    const events = await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit.events
      WHERE action = 'catalog.product.categories_set' AND actor_id = ${SEED_ACTOR.id}`;
    expect(events[0]?.n).toBe(PRODUCTS.length - 1);
  });

  it("changes nothing on a second run, nor a product staff put elsewhere", async () => {
    await iso.sql`
      DELETE FROM catalog.product_categories
      WHERE product_id = (SELECT id FROM catalog.products WHERE cnk = ${cnkFor(0)})
        AND category_id <> (SELECT id FROM catalog.categories WHERE slug = 'allergy')`;
    await iso.sql`
      INSERT INTO catalog.product_categories (product_id, category_id)
      SELECT p.id, c.id FROM catalog.products p, catalog.categories c
      WHERE p.cnk = ${cnkFor(0)} AND c.slug = 'allergy'`;
    expect(await seedSyntheticCategories()).toEqual({
      created: 0,
      assigned: 0,
      skipped: PRODUCTS.length,
    });
    expect(await categoriesOf(cnkFor(0))).toEqual(["allergy"]);
  });
});
