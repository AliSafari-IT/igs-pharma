// The demo orders of the synthetic seed against real Postgres, through the kernel as the seed CLI's
// system actors.
import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { registerAuditActions as registerCatalogAudit } from "@igs/module-catalog";
import { loadRbacCatalogue } from "@igs/module-identity";
import { registerAuditActions as registerInventoryAudit } from "@igs/module-inventory";
import {
  listOrdersForStaff,
  registerAuditActions as registerOrdersAudit,
} from "@igs/module-orders";
import { registerAuditActions as registerPricingAudit } from "@igs/module-pricing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { registerWorkerEvents } from "../src/events";
import {
  SEED_ACTOR,
  cnkFor,
  seedSyntheticCatalog,
  seedSyntheticStock,
} from "../src/synthetic-catalog";
import { DEMO_ORDERS, seedSyntheticOrders } from "../src/synthetic-orders";
import { seedSyntheticPrices } from "../src/synthetic-prices";
import { RESERVED_INDEX, seedSyntheticReservations } from "../src/synthetic-reservations";

let iso: IsolatedDatabase;

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  registerCatalogAudit(registerAuditAction);
  registerInventoryAudit(registerAuditAction);
  registerPricingAudit(registerAuditAction);
  registerOrdersAudit(registerAuditAction);
  registerWorkerEvents();
});
afterAll(async () => {
  await iso?.drop();
});
beforeEach(() => {
  const kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  kernel.clock.set(new Date());
});

const MEDICINE_ORDERS = DEMO_ORDERS.filter((demo) => demo.medicine).length;

describe("seedSyntheticOrders", () => {
  it("skips the medicine orders until a pharmacist approved a demo medicine, then adds them", async () => {
    await seedSyntheticCatalog();
    await seedSyntheticStock();
    await seedSyntheticReservations();
    await seedSyntheticPrices();

    expect(await seedSyntheticOrders()).toEqual({
      placed: DEMO_ORDERS.length - MEDICINE_ORDERS,
      skipped: MEDICINE_ORDERS,
    });
    // a pharmacist approves the texts of one demo medicine (what the back office records)
    await iso.sql`
      UPDATE catalog.product_content SET approved_by = gen_random_uuid(), approved_at = now()
      WHERE product_id = (SELECT id FROM catalog.products WHERE cnk = ${cnkFor(RESERVED_INDEX)})`;
    expect(await seedSyntheticOrders()).toEqual({
      placed: MEDICINE_ORDERS,
      skipped: DEMO_ORDERS.length - MEDICINE_ORDERS,
    });
    const { items } = await listOrdersForStaff({ pageSize: 100 }, SEED_ACTOR);
    const byName = Object.fromEntries(items.map((o) => [o.contactName, o]));
    expect(byName["Demo – wacht op betaling"]).toMatchObject({
      status: "pending_payment",
      paymentStatus: "created",
    });
    expect(byName["Demo – bij de apotheker"]).toMatchObject({
      status: "in_review",
      needsReview: true,
    });
    expect(byName["Demo – klaar om te maken"]?.status).toBe("ready_to_prepare");
    expect(byName["Demo – wordt klaargemaakt"]?.status).toBe("preparing");
    expect(byName["Demo – klaar om af te halen"]?.status).toBe("ready_for_pickup");
    expect(byName["Demo – afgehaald"]?.status).toBe("collected");
    expect(byName["Demo – betaling mislukt"]).toMatchObject({
      status: "cancelled",
      paymentStatus: "failed",
    });
    // the pharmacist's rejection asked for the refund itself: no longer due, the worker executes it
    expect(byName["Demo – afgekeurd"]).toMatchObject({ status: "cancelled", refundDue: false });
    expect(
      await iso.sql`SELECT status, reason FROM orders.refunds WHERE order_id = ${byName["Demo – afgekeurd"]?.orderId ?? ""}`,
    ).toEqual([{ status: "requested", reason: "pharmacist_rejected" }]);

    expect(await seedSyntheticOrders()).toEqual({ placed: 0, skipped: DEMO_ORDERS.length });
    expect((await listOrdersForStaff({ pageSize: 100 }, SEED_ACTOR)).total).toBe(items.length);
  });
});
