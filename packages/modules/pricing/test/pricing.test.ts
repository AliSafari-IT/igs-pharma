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
  storefrontPriceCards,
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
  it("a double submit with the same idempotency key writes one price row (#91)", async () => {
    const productId = await newProduct();
    const key = { idempotencyKey: `price:${randomUUID()}` };
    const input = { productId, amountCents: 799 };
    const first = await setPrice(input, owner, key);
    const second = await setPrice(input, owner, key);
    expect(second).toEqual(first);
    const [row] = await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pricing.prices WHERE product_id = ${productId}`;
    expect(row?.n).toBe(1);
    // the same key with other values is refused, never applied silently
    expect(await codeOf(setPrice({ productId, amountCents: 899 }, owner, key))).toBe(
      "kernel.idempotency_key_reused",
    );
  });

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
  /**
   * `storefrontPriceCards` as the read model calls it (igs-pharma#103): a plain function on the
   * caller's transaction, at the caller's `now`. The read model's kernel query is the permission check.
   */
  const cards = async (productIds: readonly string[], at: Date = clockNow) => [
    ...(await iso.db.transaction((tx) => storefrontPriceCards(tx, productIds, at))).values(),
  ];

  it("prices OTC and pharmacy-only products; a prescription, draft or unknown id is simply absent", async () => {
    const otc = await storefrontProduct();
    const pharmacyOnly = await storefrontProduct("pharmacy_only");
    const rx = await storefrontProduct("rx");
    const rxType = await storefrontProduct("otc", "rx_medicine");
    const draft = await newProduct();
    const everyone = [otc, pharmacyOnly, rx, rxType, draft];
    for (const productId of everyone) {
      await setPrice({ productId, amountCents: 500, reason: "launch" }, owner);
    }

    const seen = await cards([...everyone, randomUUID()]);
    expect(seen.map((p) => p.productId).sort()).toEqual([otc, pharmacyOnly].sort());

    // staff still price every product
    expect(await currentPrices({ productIds: everyone }, owner)).toHaveLength(5);
  });

  it("answers with the current price and its VAT part only: no price id, start, reason or author", async () => {
    const productId = await storefrontProduct();
    await setPrice({ productId, amountCents: 1000, reason: "supplier-letter-xyz" }, owner);
    const [price] = await cards([productId]);
    expect(Object.keys(price ?? {}).sort()).toEqual([
      "amountCents",
      "exVatCents",
      "productId",
      "vatCents",
      "vatClass",
      "vatRateBp",
    ]);
    expect(JSON.stringify(price)).not.toContain("supplier-letter-xyz");
  });

  it("never sees a scheduled price before it starts, nor an old one after it ends", async () => {
    const productId = await storefrontProduct();
    await setPrice({ productId, amountCents: 1000, reason: "launch" }, owner);
    await setPrice(
      { productId, amountCents: 700, validFrom: later(2 * DAY).toISOString(), reason: "sale" },
      owner,
    );
    const now = await cards([productId]);
    expect(now.map((p) => p.amountCents)).toEqual([1000]);
    const afterSale = await cards([productId], later(3 * DAY));
    expect(afterSale.map((p) => p.amountCents)).toEqual([700]);
  });

  it("a scheduled price starts exactly at its valid_from, not 1 ms before (#100)", async () => {
    const productId = await storefrontProduct();
    await setPrice({ productId, amountCents: 1000, reason: "launch" }, owner);
    const start = later(DAY);
    await setPrice(
      { productId, amountCents: 700, validFrom: start.toISOString(), reason: "sale" },
      owner,
    );
    const before = await cards([productId], new Date(start.getTime() - 1));
    expect(before.map((p) => p.amountCents)).toEqual([1000]);
    const at = await cards([productId], start);
    expect(at.map((p) => p.amountCents)).toEqual([700]);
  });

  it("is refused history, scheduled prices and the reference price, by direct call (kernel.forbidden)", async () => {
    const productId = await storefrontProduct();
    await setPrice({ productId, amountCents: 1000, reason: "launch" }, owner);
    expect(await codeOf(listPrices({ productId }, storefront))).toBe("kernel.forbidden");
    expect(await codeOf(referencePrice30Days({ productId }, storefront))).toBe("kernel.forbidden");
    expect(await codeOf(currentPrices({ productIds: [productId] }, storefront))).toBe(
      "kernel.forbidden",
    );
    expect(await codeOf(setPrice({ productId, amountCents: 1 }, storefront))).toBe(
      "kernel.forbidden",
    );
  });
});

describe("the price history's previous amounts (igs-pharma#96 regression)", () => {
  const view = (rows: readonly { amountCents: number; previousAmountCents: number | null }[]) =>
    rows.map((r) => [r.amountCents, r.previousAmountCents]);

  it("an empty history has no rows and no current price", async () => {
    const productId = await newProduct();
    const prices = await listPrices({ productId }, owner);
    expect(prices.current).toBeNull();
    expect(prices.history).toEqual([]);
    expect(prices.scheduled).toEqual([]);
  });

  it("one entry replaced nothing", async () => {
    const productId = await newProduct();
    await setPrice({ productId, amountCents: 1000, reason: "launch" }, owner);
    const { history } = await listPrices({ productId }, owner);
    expect(view(history)).toEqual([[1000, null]]);
  });

  it("the same amount twice: the second one replaced the first", async () => {
    const productId = await newProduct();
    await setPrice({ productId, amountCents: 700, reason: "launch" }, owner);
    kernel.clock.set(later(DAY));
    await setPrice({ productId, amountCents: 700, reason: "again" }, owner);
    kernel.clock.set(later(2 * DAY));
    const { history } = await listPrices({ productId }, owner);
    expect(view(history)).toEqual([
      [700, 700],
      [700, null],
    ]);
  });

  it("price changes, newest first, and scheduled changes replace the price in force before them", async () => {
    const productId = await newProduct();
    await setPrice({ productId, amountCents: 1000, reason: "launch" }, owner);
    kernel.clock.set(later(DAY));
    await setPrice({ productId, amountCents: 900, reason: "sale" }, owner);
    kernel.clock.set(later(2 * DAY));
    await setPrice({ productId, amountCents: 1100, reason: "back" }, owner);
    await setPrice(
      { productId, amountCents: 800, validFrom: later(10 * DAY).toISOString(), reason: "later" },
      owner,
    );
    await setPrice(
      {
        productId,
        amountCents: 750,
        validFrom: later(20 * DAY).toISOString(),
        reason: "later still",
      },
      owner,
    );
    const { history, scheduled, current } = await listPrices({ productId }, owner);
    expect(current?.amountCents).toBe(1100);
    expect(view(history)).toEqual([
      [1100, 900],
      [900, 1000],
      [1000, null],
    ]);
    // soonest first, as before: the scheduled rows keep their own order
    expect(view(scheduled)).toEqual([
      [800, 1100],
      [750, 800],
    ]);
  });

  it("two prices that start at the same instant both replaced the price before that instant", async () => {
    const productId = await newProduct();
    await setPrice({ productId, amountCents: 1000, reason: "launch" }, owner);
    const at = later(5 * DAY).toISOString();
    await setPrice({ productId, amountCents: 900, validFrom: at, reason: "first" }, owner);
    await setPrice({ productId, amountCents: 800, validFrom: at, reason: "second" }, owner);
    kernel.clock.set(later(6 * DAY));
    const { history } = await listPrices({ productId }, owner);
    // the row written last wins at that instant (newest first); both replaced the 1000
    expect(history.map((r) => r.previousAmountCents).sort()).toEqual([1000, 1000, null].sort());
    expect(history.filter((r) => r.amountCents !== 1000).map((r) => r.previousAmountCents)).toEqual(
      [1000, 1000],
    );
  });
});
