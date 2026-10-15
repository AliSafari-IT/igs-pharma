// The dashboard's stock summary (igs-pharma#115) against real Postgres: out, low and active
// reservations counted in one statement, and the same answers as paging through `listStock` and
// opening every product with `getStock`. A database of its own, so the counts are exact.
import { randomUUID } from "node:crypto";

import { newId } from "@igs/db/ids";
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
  DEFAULT_LOW_STOCK,
  adjustStock,
  availabilityStatus,
  confirmReservation,
  getStock,
  getStockSummary,
  listStock,
  registerAuditActions,
  releaseReservation,
  reserveStock,
  runReservationExpiry,
} from "../src";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;
let t0: Date;

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  registerCatalogAudit(registerAuditAction);
  registerAuditActions(registerAuditAction);
  t0 = new Date();
});
afterAll(async () => {
  await iso?.drop();
});
beforeEach(() => {
  kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  kernel.clock.set(t0); // audit partitions exist around "now"
});

const MINUTE = 60_000;
const at = (ms: number) => new Date(t0.getTime() + ms);

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
const checkout: Actor = { type: "system", id: "checkout", roles: ["system_reservations"] };
const storefront: Actor = { type: "system", id: "storefront", roles: ["system_storefront"] };

let nextCnk = 9_700_100;

/** A catalog product, active unless `draft` (the stock list shows drafts too). */
async function product(draft = false): Promise<string> {
  const cnk = String(nextCnk++);
  const { productId } = await createProductRegulated(
    {
      cnk,
      productType: "otc_medicine",
      legalStatus: "otc",
      vatClass: "BE_6",
      approveContent: true,
      content: [
        { locale: "nl", name: `Demo ${cnk}` },
        { locale: "fr", name: `Demo ${cnk} FR` },
      ],
    },
    pharmacist,
  );
  if (!draft) await setProductStatusRegulated({ productId, status: "active" }, pharmacist);
  return productId;
}

/** A product with `onHand` units on the shelf. */
async function stocked(onHand: number): Promise<string> {
  const productId = await product();
  if (onHand > 0) {
    await adjustStock({ productId, delta: onHand, reason: "adjustment", note: "seed" }, owner);
  }
  return productId;
}

const holder = () => `checkout:${newId()}`;

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "ok";
};

/** The same numbers the slow way: every page of `listStock`, and `getStock` for every product. */
async function countedFromTheList() {
  let low = 0;
  let out = 0;
  let activeReservations = 0;
  for (let page = 1; ; page += 1) {
    const result = await listStock({ page, pageSize: 100 }, pharmacist);
    for (const item of result.items) {
      const status = availabilityStatus(item.available, DEFAULT_LOW_STOCK);
      if (status === "out") out += 1;
      if (status === "low") low += 1;
      const stock = await getStock({ productId: item.productId }, pharmacist);
      activeReservations += stock.reservations.length;
    }
    if (page * result.pageSize >= result.total) break;
  }
  return { low, out, activeReservations };
}

describe("inventory.stock.summary", () => {
  it("is all zeros for an empty catalogue", async () => {
    expect(await getStockSummary({}, pharmacist)).toEqual({
      low: 0,
      out: 0,
      activeReservations: 0,
    });
  });

  it("counts out, low and live reservations exactly as the stock list and the product page do", async () => {
    // ends that no longer set stock aside: a hold the job expired, one that lapsed without the job,
    // and one the checkout released
    const expired = await stocked(2); // available 2: low
    await reserveStock({ productId: expired, quantity: 2, holderRef: holder() }, checkout);
    kernel.clock.set(at(5 * MINUTE));
    const lapsed = await stocked(4); // available 4: ok
    await reserveStock({ productId: lapsed, quantity: 4, holderRef: holder() }, checkout);
    kernel.clock.set(at(16 * MINUTE));
    expect(await runReservationExpiry()).toBe(1); // only the first is past its expires_at
    kernel.clock.set(at(21 * MINUTE)); // the second is now past it too, still `active` in the table
    const released = await stocked(3); // available 3 again: low
    const releasedRef = holder();
    await reserveStock({ productId: released, quantity: 3, holderRef: releasedRef }, checkout);
    await releaseReservation({ holderRef: releasedRef, reason: "checkout_cancelled" }, checkout);

    // live reservations: two holds and one order
    await stocked(0); // out
    await product(true); // out: a draft is on the stock list too
    const allHeld = await stocked(2); // available 0: out
    await reserveStock({ productId: allHeld, quantity: 2, holderRef: holder() }, checkout);
    const plenty = await stocked(10); // available 9: ok
    await reserveStock({ productId: plenty, quantity: 1, holderRef: holder() }, checkout);
    const ordered = await stocked(5); // available 3 (the threshold): low
    const orderRef = holder();
    await reserveStock({ productId: ordered, quantity: 2, holderRef: orderRef }, checkout);
    await confirmReservation(
      { holderRef: orderRef, items: [{ productId: ordered, quantity: 2 }] },
      checkout,
    );
    await stocked(1); // low

    const summary = await getStockSummary({}, pharmacist);
    expect(summary).toEqual({ low: 4, out: 3, activeReservations: 3 });
    expect(await countedFromTheList()).toEqual(summary);
  });

  it("the threshold is the storefront's `low` (1 up to DEFAULT_LOW_STOCK)", async () => {
    kernel.clock.set(at(21 * MINUTE)); // where the previous test left the holds
    const before = await getStockSummary({}, pharmacist);
    await stocked(DEFAULT_LOW_STOCK);
    await stocked(DEFAULT_LOW_STOCK + 1);
    expect(await getStockSummary({}, pharmacist)).toEqual({ ...before, low: before.low + 1 });
    expect(await countedFromTheList()).toEqual(await getStockSummary({}, pharmacist));
  });

  it("has the stock list's permission: staff who read stock, not a content editor or the storefront", async () => {
    for (const actor of [owner, pharmacist, assistant]) {
      expect(await codeOf(getStockSummary({}, actor))).toBe("ok");
    }
    for (const actor of [editor, storefront, checkout]) {
      expect(await codeOf(getStockSummary({}, actor))).toBe("kernel.forbidden");
    }
  });
});
