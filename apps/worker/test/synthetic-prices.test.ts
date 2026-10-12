// The demo prices of the synthetic seed (igs-pharma#59) against real Postgres, through the kernel as
// the seed CLI's system actor, with the RBAC catalogue loaded from the database.
import { randomUUID } from "node:crypto";

import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import type { Actor } from "@igs/kernel";
import { configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { listProducts, registerAuditActions as registerCatalogAudit } from "@igs/module-catalog";
import { loadRbacCatalogue } from "@igs/module-identity";
import { listPrices, registerAuditActions, setPrice } from "@igs/module-pricing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PRODUCTS, cnkFor, seedSyntheticCatalog } from "../src/synthetic-catalog";
import {
  SCHEDULED_INDEX,
  demoPriceFor,
  scheduledPriceFor,
  seedSyntheticPrices,
} from "../src/synthetic-prices";

let iso: IsolatedDatabase;

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
  const kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  kernel.clock.set(new Date()); // audit partitions exist around "now"
});

const owner: Actor = {
  type: "user",
  id: randomUUID(),
  roles: ["owner"],
  kind: "staff",
  mfaVerified: true,
};

const idOf = async (index: number) => {
  const [item] = (await listProducts({ cnk: cnkFor(index), pageSize: 1 }, owner)).items;
  if (!item) throw new Error(`no seed product ${index}`);
  return item.id;
};

describe("seedSyntheticPrices", () => {
  // the tests share one database and run in order: a first run, then a re-run
  it("prices every seed product and schedules one change for tomorrow", async () => {
    await seedSyntheticCatalog();
    // a price staff set before the seed ran is left alone
    const staffPriced = SCHEDULED_INDEX + 1;
    await setPrice({ productId: await idOf(staffPriced), amountCents: 1_000 }, owner);

    expect(await seedSyntheticPrices()).toEqual({
      priced: PRODUCTS.length - 1,
      scheduled: 1,
      skipped: 1,
    });
    for (const index of [SCHEDULED_INDEX, PRODUCTS.length - 1]) {
      const prices = await listPrices({ productId: await idOf(index) }, owner);
      expect(prices.current?.amountCents).toBe(demoPriceFor(index));
    }
    const scheduled = await listPrices({ productId: await idOf(SCHEDULED_INDEX) }, owner);
    expect(scheduled.scheduled.map((r) => [r.previousAmountCents, r.amountCents])).toEqual([
      [demoPriceFor(SCHEDULED_INDEX), scheduledPriceFor(SCHEDULED_INDEX)],
    ]);
    const staff = await listPrices({ productId: await idOf(staffPriced) }, owner);
    expect(staff.history.map((r) => r.amountCents)).toEqual([1_000]);
  });

  it("changes nothing on a second run", async () => {
    expect(await seedSyntheticPrices()).toEqual({
      priced: 0,
      scheduled: 0,
      skipped: PRODUCTS.length,
    });
    const [{ rows }] = (await iso.sql`SELECT count(*)::int AS rows FROM pricing.prices`) as [
      { rows: number },
    ];
    expect(rows).toBe(PRODUCTS.length + 1);
  });

  it("every demo price is a valid amount", () => {
    for (const index of PRODUCTS.keys()) {
      expect(demoPriceFor(index)).toBeGreaterThanOrEqual(349);
      expect(demoPriceFor(index) % 10).toBe(9);
    }
  });
});
