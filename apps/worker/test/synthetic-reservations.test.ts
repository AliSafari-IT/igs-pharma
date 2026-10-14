// The demo reservations of the synthetic seed (igs-pharma#99) against real Postgres, through the
// kernel as the seed CLI's system actors.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { listProducts, registerAuditActions as registerCatalogAudit } from "@igs/module-catalog";
import { loadRbacCatalogue } from "@igs/module-identity";
import { getStock, registerAuditActions as registerInventoryAudit } from "@igs/module-inventory";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  SEED_ACTOR,
  cnkFor,
  demoStockFor,
  seedSyntheticCatalog,
  seedSyntheticStock,
} from "../src/synthetic-catalog";
import {
  RESERVED_INDEX,
  RESERVED_QUANTITY,
  SHORT_INDEX,
  SHORT_MISSING,
  seedSyntheticReservations,
} from "../src/synthetic-reservations";

let iso: IsolatedDatabase;

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  registerCatalogAudit(registerAuditAction);
  registerInventoryAudit(registerAuditAction);
});
afterAll(async () => {
  await iso?.drop();
});
beforeEach(() => {
  const kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  kernel.clock.set(new Date()); // audit partitions exist around "now"
});

const stockOfSeed = async (index: number) => {
  const [item] = (await listProducts({ cnk: cnkFor(index), pageSize: 1 }, SEED_ACTOR)).items;
  if (!item) throw new Error("seed product missing");
  return getStock({ productId: item.id }, SEED_ACTOR);
};

describe("seedSyntheticReservations", () => {
  it("sets one order aside, and another that is more than the shelf holds (short); a second run changes nothing", async () => {
    await seedSyntheticCatalog();
    await seedSyntheticStock();
    const first = await seedSyntheticReservations();
    expect(first).toEqual({ reserved: 2, skipped: 0 });

    const plain = await stockOfSeed(RESERVED_INDEX);
    expect([plain.onHand, plain.ordered, plain.available, plain.short]).toEqual([
      demoStockFor(RESERVED_INDEX),
      RESERVED_QUANTITY,
      demoStockFor(RESERVED_INDEX) - RESERVED_QUANTITY,
      0,
    ]);
    expect(plain.reservations.map((r) => r.kind)).toEqual(["order"]);
    expect(plain.reservations[0]?.expiresAt).toBeNull();

    const short = await stockOfSeed(SHORT_INDEX);
    expect([short.onHand, short.ordered, short.available, short.short]).toEqual([
      demoStockFor(SHORT_INDEX) - SHORT_MISSING,
      demoStockFor(SHORT_INDEX),
      0,
      SHORT_MISSING,
    ]);

    expect(await seedSyntheticReservations()).toEqual({ reserved: 0, skipped: 2 });
    expect((await stockOfSeed(RESERVED_INDEX)).reservations).toHaveLength(1);
  });
});
