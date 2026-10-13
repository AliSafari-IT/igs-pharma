// Pricing commands and queries (igs-pharma#59) against real Postgres, with the RBAC catalogue
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
  currentPrices,
  listPrices,
  referencePrice30Days,
  registerAuditActions,
  setPrice,
} from "../src";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;
/** The kernel's clock for the current test; prices start relative to it, not to the wall clock. */
let clockNow: Date;

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
  clockNow = new Date();
  kernel.clock.set(clockNow); // audit partitions exist around "now"
});

const DAY = 86_400_000;
const later = (ms: number) => new Date(clockNow.getTime() + ms);

const staff = (...roles: string[]): Actor => ({
  type: "user",
  id: randomUUID(),
  roles,
  kind: "staff",
  mfaVerified: true,
});

const owner = staff("owner");
/** Regulated products are created and activated by a pharmacist (D-034, #79). */
const pharmacist = staff("pharmacist");

let nextCnk = 9_700_100;

async function newProduct(vatClass: "BE_6" | "BE_21" = "BE_6"): Promise<string> {
  const cnk = String(nextCnk++);
  const { productId } = await createProductRegulated(
    {
      cnk,
      productType: "otc_medicine",
      legalStatus: "otc",
      vatClass,
      content: [{ locale: "nl", name: `Demo ${cnk}` }],
    },
    pharmacist,
  );
  return productId;
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

describe("pricing.price.set and the current price", () => {
  it("the current price is the latest one that has started; a later one is scheduled", async () => {
    const productId = await newProduct();
    await setPrice({ productId, amountCents: 599, reason: "launch" }, owner);
    const scheduled = await setPrice(
      { productId, amountCents: 649, validFrom: later(DAY).toISOString() },
      owner,
    );
    expect(scheduled.scheduled).toBe(true);

    const [current] = await currentPrices({ productIds: [productId] }, owner);
    expect(current).toMatchObject({
      productId,
      amountCents: 599,
      vatClass: "BE_6",
      vatRateBp: 600,
    });
    expect(current?.vatCents).toBe(34);
    expect(current?.exVatCents).toBe(565);

    const page = await listPrices({ productId }, owner);
    expect(page.current?.amountCents).toBe(599);
    expect(page.scheduled.map((r) => [r.amountCents, r.previousAmountCents])).toEqual([[649, 599]]);
    expect(page.history.map((r) => [r.amountCents, r.previousAmountCents, r.reason])).toEqual([
      [599, null, "launch"],
    ]);
    expect(page.history[0]?.createdBy).toBe(owner.id);

    // once its start has passed, the scheduled price is current
    kernel.clock.set(later(DAY + 1000));
    const [tomorrow] = await currentPrices({ productIds: [productId] }, owner);
    expect(tomorrow?.amountCents).toBe(649);
    const after = await listPrices({ productId }, owner);
    expect(after.scheduled).toEqual([]);
    expect(after.history.map((r) => r.amountCents)).toEqual([649, 599]);
  });

  it("splits VAT for both classes", async () => {
    const six = await newProduct("BE_6");
    const twentyOne = await newProduct("BE_21");
    await setPrice({ productId: six, amountCents: 999 }, owner);
    await setPrice({ productId: twentyOne, amountCents: 10_000 }, owner);
    const rows = await currentPrices({ productIds: [six, twentyOne, randomUUID()] }, owner);
    expect(rows.map((r) => [r.vatClass, r.amountCents, r.vatCents, r.exVatCents])).toEqual([
      ["BE_6", 999, 57, 942],
      ["BE_21", 10_000, 1736, 8264],
    ]);
  });

  it("a product without a price has no current price", async () => {
    const productId = await newProduct();
    expect(await currentPrices({ productIds: [productId] }, owner)).toEqual([]);
    const page = await listPrices({ productId }, owner);
    expect(page).toMatchObject({ current: null, scheduled: [], history: [], vatRateBp: 600 });
  });

  it("refuses an invalid amount, a start in the past and an unknown product", async () => {
    const productId = await newProduct();
    for (const amountCents of [0, -5, 12.5, 10_000_001]) {
      expect(await codeOf(setPrice({ productId, amountCents }, owner)), String(amountCents)).toBe(
        "pricing.amount_invalid",
      );
    }
    expect(
      await codeOf(
        setPrice({ productId, amountCents: 100, validFrom: later(-60_000).toISOString() }, owner),
      ),
    ).toBe("pricing.valid_from_in_past");
    expect(await codeOf(setPrice({ productId: randomUUID(), amountCents: 100 }, owner))).toBe(
      "pricing.unknown_product",
    );
    expect(await codeOf(listPrices({ productId: randomUUID() }, owner))).toBe(
      "pricing.unknown_product",
    );
  });
});

describe("pricing.price.reference_30d", () => {
  it("the reference of a reduction is the lowest price BEFORE it, not the reduction itself", async () => {
    const productId = await newProduct();
    const start = clockNow;
    await setPrice({ productId, amountCents: 1000 }, owner);
    kernel.clock.set(new Date(start.getTime() + 40 * DAY));
    await setPrice({ productId, amountCents: 700 }, owner); // the reduction

    const at = async (atMs: number) =>
      (await referencePrice30Days({ productId, at: new Date(atMs).toISOString() }, owner))
        .reduction;
    const reductionAt = start.getTime() + 40 * DAY;
    expect(await at(reductionAt - 1)).toBeNull(); // not applied yet
    for (const when of [reductionAt, reductionAt + 10 * DAY, reductionAt + 90 * DAY]) {
      expect(await at(when)).toEqual({
        currentCents: 700,
        appliedAt: new Date(reductionAt),
        referenceCents: 1000,
        fullWindow: true,
      });
    }
    // before the first price there is nothing
    expect(await at(start.getTime() - 1)).toBeNull();
    // default `at`: the kernel clock, i.e. the day of the reduction
    expect((await referencePrice30Days({ productId }, owner)).reduction).toMatchObject({
      currentCents: 700,
      referenceCents: 1000,
    });
  });

  it("flags a product priced for less than 30 days, and is none for a rise", async () => {
    const productId = await newProduct();
    const start = clockNow;
    await setPrice({ productId, amountCents: 1000 }, owner);
    kernel.clock.set(new Date(start.getTime() + 10 * DAY));
    await setPrice({ productId, amountCents: 700 }, owner);
    kernel.clock.set(new Date(start.getTime() + 11 * DAY));
    const { reduction } = await referencePrice30Days({ productId }, owner);
    expect(reduction).toMatchObject({ referenceCents: 1000, fullWindow: false });

    kernel.clock.set(new Date(start.getTime() + 12 * DAY));
    await setPrice({ productId, amountCents: 1500 }, owner); // a rise is not a reduction
    expect((await referencePrice30Days({ productId }, owner)).reduction).toBeNull();
  });

  it("refuses an unknown product", async () => {
    expect(await codeOf(referencePrice30Days({ productId: randomUUID() }, owner))).toBe(
      "pricing.unknown_product",
    );
  });
});

describe("append-only", () => {
  it("refuses UPDATE, DELETE and TRUNCATE on prices and VAT rates", async () => {
    const productId = await newProduct();
    const { priceId } = await setPrice({ productId, amountCents: 500 }, owner);
    const refused = async (statement: Promise<unknown>) => {
      try {
        await statement;
      } catch (error) {
        return String((error as Error).message);
      }
      return "ok";
    };
    expect(
      await refused(iso.sql`UPDATE pricing.prices SET amount_cents = 1 WHERE id = ${priceId}`),
    ).toContain("append-only");
    expect(await refused(iso.sql`DELETE FROM pricing.prices WHERE id = ${priceId}`)).toContain(
      "append-only",
    );
    expect(await refused(iso.sql`TRUNCATE pricing.prices`)).toContain("append-only");
    expect(await refused(iso.sql`UPDATE pricing.vat_classes SET rate_bp = 0`)).toContain(
      "append-only",
    );
    expect(await refused(iso.sql`DELETE FROM pricing.vat_classes`)).toContain("append-only");
  });
});

describe("permissions and audit", () => {
  it("only roles with pricing.price.read|manage can read or set prices", async () => {
    const productId = await newProduct();
    for (const role of ["pharmacist", "pharmacy_assistant", "content_editor", "customer_service"]) {
      const actor = staff(role);
      expect(await codeOf(setPrice({ productId, amountCents: 100 }, actor)), role).toBe(
        "kernel.forbidden",
      );
      expect(await codeOf(listPrices({ productId }, actor)), role).toBe("kernel.forbidden");
      expect(await codeOf(currentPrices({ productIds: [productId] }, actor)), role).toBe(
        "kernel.forbidden",
      );
      expect(await codeOf(referencePrice30Days({ productId }, actor)), role).toBe(
        "kernel.forbidden",
      );
    }
  });

  it("audits identifiers and the amount, never the reason", async () => {
    const productId = await newProduct();
    const validFrom = later(2 * DAY).toISOString();
    const { priceId } = await setPrice(
      { productId, amountCents: 1299, validFrom, reason: "supplier-letter-xyz" },
      owner,
    );
    const events = await iso.sql<{ action: string; data: Record<string, unknown> }[]>`
      SELECT action, data FROM audit.events
      WHERE entity_id = ${productId} AND action LIKE 'pricing.%' ORDER BY seq`;
    expect(events).toEqual([
      {
        action: "pricing.price.set",
        data: { priceId, productId, channel: "web", amountCents: 1299, validFrom, scheduled: true },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("supplier-letter-xyz");
  });
});

describe("the storefront prices storefront-visible products only (D-034)", () => {
  const storefront: Actor = { type: "system", id: "storefront", roles: ["system_storefront"] };

  it("prices OTC and pharmacy-only products; a prescription, draft or unknown id is absent or unknown", async () => {
    const otc = await storefrontProduct();
    const pharmacyOnly = await storefrontProduct("pharmacy_only");
    const rx = await storefrontProduct("rx");
    const rxType = await storefrontProduct("otc", "rx_medicine");
    const draft = await newProduct();
    const everyone = [otc, pharmacyOnly, rx, rxType, draft];
    for (const productId of everyone) {
      await setPrice({ productId, amountCents: 500, reason: "launch" }, owner);
    }

    const seen = await currentPrices({ productIds: [...everyone, randomUUID()] }, storefront);
    expect(seen.map((p) => p.productId).sort()).toEqual([otc, pharmacyOnly].sort());

    for (const hidden of [rx, rxType, draft, randomUUID()]) {
      expect(await codeOf(listPrices({ productId: hidden }, storefront)), hidden).toBe(
        "pricing.unknown_product",
      );
      expect(await codeOf(referencePrice30Days({ productId: hidden }, storefront)), hidden).toBe(
        "pricing.unknown_product",
      );
    }
    expect(await codeOf(listPrices({ productId: otc }, storefront))).toBe("ok");

    // staff still price every product
    expect(await currentPrices({ productIds: everyone }, owner)).toHaveLength(5);
  });
});
