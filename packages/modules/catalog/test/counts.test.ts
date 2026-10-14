// catalog.product.counts (igs-pharma#115) against real Postgres: counts by status, and the
// medicines whose text no pharmacist has approved.
import { randomUUID } from "node:crypto";

import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { type Actor, isDomainError } from "@igs/kernel";
import { type KernelTestHandles, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { loadRbacCatalogue } from "@igs/module-identity";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createProduct,
  createProductRegulated,
  getProductCounts,
  registerAuditActions,
  setProductStatus,
  setProductStatusRegulated,
} from "../src";

let iso: IsolatedDatabase;
let kernel: KernelTestHandles;

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  registerAuditActions(registerAuditAction);
});
afterAll(async () => {
  await iso?.drop();
});
beforeEach(() => {
  kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  kernel.clock.set(new Date());
});

const staff = (...roles: string[]): Actor => ({
  type: "user",
  id: randomUUID(),
  roles,
  kind: "staff",
  mfaVerified: true,
});
const editor = staff("content_editor");
const pharmacist = staff("pharmacist");

let nextCnk = 9_700_100;
const cnk = () => String(nextCnk++);
const nl = { locale: "nl", name: "Demo" } as const;
const fr = { locale: "fr", name: "Démo" } as const;
const general = (overrides: Record<string, unknown> = {}) => ({
  cnk: cnk(),
  productType: "general",
  legalStatus: "general_sale",
  vatClass: "BE_21",
  content: [nl, fr],
  ...overrides,
});
const medicine = (overrides: Record<string, unknown> = {}) => ({
  cnk: cnk(),
  productType: "otc_medicine",
  legalStatus: "otc",
  vatClass: "BE_6",
  content: [nl, fr],
  ...overrides,
});

describe("catalog.product.counts", () => {
  it("is zero on an empty catalogue", async () => {
    expect(await getProductCounts({}, editor)).toEqual({
      active: 0,
      draft: 0,
      archived: 0,
      awaitingApproval: 0,
    });
  });

  it("counts by status, and the medicines whose nl or fr text is not approved", async () => {
    // general products: an editor approves its own text; never "awaiting"
    const a = await createProduct(general(), editor);
    await setProductStatus({ productId: a.productId, status: "active" }, editor);
    await createProduct(general(), editor); // draft
    const archivedGeneral = await createProduct(general(), editor);
    await setProductStatus({ productId: archivedGeneral.productId, status: "archived" }, editor);

    // medicines: unapproved, approved, approved only in nl, and an archived unapproved one
    await createProductRegulated(medicine(), pharmacist); // draft, unapproved: counted
    await createProductRegulated(medicine({ approveContent: true }), pharmacist); // draft, approved
    const activeUnapproved = await createProductRegulated(medicine(), pharmacist);
    await setProductStatusRegulated(
      { productId: activeUnapproved.productId, status: "active" },
      pharmacist,
    );
    const archivedUnapproved = await createProductRegulated(medicine(), pharmacist);
    await setProductStatusRegulated(
      { productId: archivedUnapproved.productId, status: "archived" },
      pharmacist,
    );
    const nlOnly = await createProductRegulated(medicine({ approveContent: true }), pharmacist);
    await iso.sql`
      UPDATE catalog.product_content SET approved_by = NULL, approved_at = NULL
      WHERE product_id = ${nlOnly.productId} AND locale = 'fr'`;

    expect(await getProductCounts({}, editor)).toEqual({
      active: 2, // the general one and the unapproved medicine
      draft: 4, // general, two medicines (unapproved, approved), nl-only
      archived: 2,
      awaitingApproval: 3, // draft unapproved, active unapproved, nl-only (archived and approved ones do not count)
    });
  });

  it("counts a medicine by its legal status too (a general-type product with an Rx status)", async () => {
    const before = (await getProductCounts({}, editor)).awaitingApproval;
    const id = randomUUID();
    await iso.sql`
      INSERT INTO catalog.products (id, cnk, product_type, legal_status, vat_class, status)
      VALUES (${id}, ${cnk()}, 'cosmetic', 'rx', 'BE_21', 'active')`;
    await iso.sql`
      INSERT INTO catalog.product_content (product_id, locale, name, source)
      VALUES (${id}, 'nl', 'Rx demo', 'manual'), (${id}, 'fr', 'Rx démo', 'manual')`;
    expect((await getProductCounts({}, editor)).awaitingApproval).toBe(before + 1);
  });

  it("needs catalog.products.read, and returns counts only", async () => {
    const counts = await getProductCounts({}, pharmacist);
    expect(Object.keys(counts).sort()).toEqual(["active", "archived", "awaitingApproval", "draft"]);
    expect(Object.values(counts).every((n) => typeof n === "number")).toBe(true);
    // a role without the permission is refused with the typed error
    const outsider = staff("customer");
    try {
      await getProductCounts({}, outsider);
      expect.unreachable("must be refused");
    } catch (error) {
      expect(isDomainError(error) && error.code).toBe("kernel.forbidden");
    }
  });
});
