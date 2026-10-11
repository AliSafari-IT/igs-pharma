// The synthetic catalogue seed (igs-pharma#50) against real Postgres, through the kernel as the
// seed CLI's system actor, with the RBAC catalogue loaded from the database (igs-pharma#51 review).
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { createProduct, registerAuditActions } from "@igs/module-catalog";
import { loadRbacCatalogue } from "@igs/module-identity";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  BRANDS,
  PRODUCTS,
  SEED_ACTOR,
  cnkFor,
  seedSyntheticCatalog,
} from "../src/synthetic-catalog";

let iso: IsolatedDatabase;

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  registerAuditActions(registerAuditAction);
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
