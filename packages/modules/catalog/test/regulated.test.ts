// Regulated product fields (igs-pharma#79, D-034) against real Postgres: only a pharmacist sets
// them, activates a medicine or approves medicine text; two command families, one permission each.
import { randomUUID } from "node:crypto";

import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { type Actor, isDomainError } from "@igs/kernel";
import { type KernelTestHandles, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { loadRbacCatalogue } from "@igs/module-identity";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  LEGAL_STATUSES,
  PRODUCT_TYPES,
  createProduct,
  createProductRegulated,
  getProduct,
  legalStatusFits,
  listInconsistentProducts,
  registerAuditActions,
  setProductStatus,
  setProductStatusRegulated,
  updateProduct,
  updateProductRegulated,
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
  kernel.clock.set(new Date()); // audit partitions exist around "now"
});

const staff = (...roles: string[]): Actor => ({
  type: "user",
  id: randomUUID(),
  roles,
  kind: "staff",
  mfaVerified: true,
});
const editor = staff("content_editor");
const owner = staff("owner");
const pharmacist = staff("pharmacist");
const titular = staff("pharmacist_titular");
const assistant = staff("pharmacy_assistant");
const seed: Actor = { type: "system", id: "seed-catalog", roles: ["system_seed"] };

const REQUIRED = "catalog.regulated_fields_require_pharmacist";
const ACTIVATION = "catalog.medicine_activation_requires_pharmacist";
const MISMATCH = "catalog.product_type_legal_status_mismatch";

let nextCnk = 9_500_100;
const cnk = () => String(nextCnk++);
const nl = { locale: "nl", name: "Demo product" } as const;
const fr = { locale: "fr", name: "Produit démo" } as const;

/** What a content editor may create. */
const general = (overrides: Record<string, unknown> = {}) => ({
  cnk: cnk(),
  productType: "general",
  legalStatus: "general_sale",
  vatClass: "BE_21",
  content: [nl, fr],
  ...overrides,
});
/** A medicine: pharmacist territory. */
const medicine = (overrides: Record<string, unknown> = {}) =>
  general({ productType: "otc_medicine", legalStatus: "otc", vatClass: "BE_6", ...overrides });

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "ok";
};

const auditFor = (entityId: string) =>
  iso.sql<{ action: string; actor_id: string; data: Record<string, unknown> }[]>`
    SELECT action, actor_id, data FROM audit.events WHERE entity_id = ${entityId} ORDER BY seq`;

const approvals = async (productId: string) =>
  (await getProduct({ productId }, pharmacist)).content
    .map((c) => ({ locale: c.locale, by: c.approvedBy, at: c.approvedAt }))
    .sort((a, b) => a.locale.localeCompare(b.locale));

describe("a content editor creates only general products", () => {
  it("accepts the general envelope, for the editor and the owner", async () => {
    for (const actor of [editor, owner]) {
      const { productId } = await createProduct(general(), actor);
      expect((await getProduct({ productId }, actor)).status).toBe("draft");
    }
  });

  it.each([
    ["a medicine", { productType: "otc_medicine", legalStatus: "otc" }],
    ["a prescription medicine", { productType: "rx_medicine", legalStatus: "rx" }],
    ["legal status pharmacy_only", { legalStatus: "pharmacy_only" }],
    ["another VAT class (pharmacist-only, D-034)", { vatClass: "BE_6" }],
    ["a pharmacist-review flag", { requiresPharmacistReview: true }],
    ["a minimum age", { ageMin: 12 }],
  ])("refuses %s with %s", async (_label, overrides) => {
    for (const actor of [editor, owner]) {
      expect(await codeOf(createProduct(general(overrides), actor))).toBe(REQUIRED);
    }
  });

  it("writes nothing when it refuses", async () => {
    const refused = general({ productType: "rx_medicine", legalStatus: "rx" });
    await codeOf(createProduct(refused, editor));
    const rows = await iso.sql`SELECT 1 FROM catalog.products WHERE cnk = ${refused.cnk}`;
    expect(rows).toHaveLength(0);
  });
});

describe("the regulated commands belong to pharmacists", () => {
  it("lets the pharmacist, the titular and the seed CLI create any product", async () => {
    for (const actor of [pharmacist, titular, seed]) {
      const { productId } = await createProductRegulated(
        medicine({ productType: "rx_medicine", legalStatus: "rx", ageMin: 18 }),
        actor,
      );
      expect(await getProduct({ productId }, pharmacist)).toMatchObject({
        productType: "rx_medicine",
        legalStatus: "rx",
        ageMin: 18,
      });
    }
  });

  it("refuses the owner (D-030), the editor and the assistant on every regulated command", async () => {
    const { productId } = await createProductRegulated(medicine(), pharmacist);
    for (const actor of [owner, editor, assistant, staff("customer_service")]) {
      expect(await codeOf(createProductRegulated(medicine(), actor))).toBe("kernel.forbidden");
      expect(await codeOf(updateProductRegulated({ productId, ...medicine() }, actor))).toBe(
        "kernel.forbidden",
      );
      expect(
        await codeOf(setProductStatusRegulated({ productId, status: "archived" }, actor)),
      ).toBe("kernel.forbidden");
    }
  });

  it("keeps the content commands out of the pharmacist's hands: she holds the regulated permission only", async () => {
    expect(await codeOf(createProduct(general(), pharmacist))).toBe("kernel.forbidden");
    const { productId } = await createProduct(general(), editor);
    expect(await codeOf(updateProduct({ productId, ...general() }, pharmacist))).toBe(
      "kernel.forbidden",
    );
    expect(await codeOf(setProductStatus({ productId, status: "archived" }, titular))).toBe(
      "kernel.forbidden",
    );
  });
});

describe("product type and legal status must agree", () => {
  const combos = PRODUCT_TYPES.flatMap((productType) =>
    LEGAL_STATUSES.map((legalStatus) => ({ productType, legalStatus })),
  );

  it("accepts exactly the consistent combinations, on create and on update", async () => {
    const { productId } = await createProductRegulated(general(), pharmacist);
    for (const combo of combos) {
      const expected = legalStatusFits(combo.productType, combo.legalStatus) ? "ok" : MISMATCH;
      expect(
        await codeOf(createProductRegulated(general(combo), pharmacist)),
        `create ${combo.productType}/${combo.legalStatus}`,
      ).toBe(expected);
      expect(
        await codeOf(updateProductRegulated({ productId, ...general(combo) }, pharmacist)),
        `update ${combo.productType}/${combo.legalStatus}`,
      ).toBe(expected);
    }
  });

  it("states the rule: otc_medicine is otc, rx_medicine is rx, the rest pharmacy_only or general_sale", () => {
    expect(legalStatusFits("otc_medicine", "otc")).toBe(true);
    expect(legalStatusFits("otc_medicine", "rx")).toBe(false);
    expect(legalStatusFits("rx_medicine", "rx")).toBe(true);
    expect(legalStatusFits("rx_medicine", "otc")).toBe(false);
    expect(legalStatusFits("cosmetic", "general_sale")).toBe(true);
    expect(legalStatusFits("medical_device", "pharmacy_only")).toBe(true);
    expect(legalStatusFits("cosmetic", "otc")).toBe(false);
  });
});

describe("a content save guards the regulated values", () => {
  it("passes when the regulated values are unchanged", async () => {
    const { productId } = await createProductRegulated(
      medicine({ requiresPharmacistReview: true, ageMin: 12 }),
      pharmacist,
    );
    const same = medicine({ requiresPharmacistReview: true, ageMin: 12, coldChain: true });
    await updateProduct(
      { productId, ...same, cnk: (await getProduct({ productId }, editor)).cnk },
      editor,
    );
    expect((await getProduct({ productId }, editor)).coldChain).toBe(true);
  });

  it.each([
    ["productType", { productType: "rx_medicine", legalStatus: "rx" }],
    ["legalStatus", { productType: "medical_device", legalStatus: "pharmacy_only" }],
    ["vatClass", { vatClass: "BE_21" }],
    ["requiresPharmacistReview", { requiresPharmacistReview: false }],
    ["ageMin", { ageMin: 16 }],
  ])("refuses a changed %s with the typed error and changes nothing", async (field, change) => {
    const { productId } = await createProductRegulated(
      medicine({ requiresPharmacistReview: true, ageMin: 12 }),
      pharmacist,
    );
    const stored = await getProduct({ productId }, editor);
    const attempt = {
      productId,
      cnk: stored.cnk,
      productType: stored.productType,
      legalStatus: stored.legalStatus,
      vatClass: stored.vatClass,
      requiresPharmacistReview: stored.requiresPharmacistReview,
      ageMin: stored.ageMin,
      content: [{ ...nl, name: "Changed name" }, fr],
      ...change,
    };
    for (const actor of [editor, owner]) {
      try {
        await updateProduct(attempt, actor);
        expect.unreachable("the save must be refused");
      } catch (error) {
        expect(isDomainError(error) && error.code).toBe(REQUIRED);
        // the refusal names the fields, never their values
        expect(isDomainError(error) && error.details?.["fields"]).toContain(field);
      }
    }
    const after = await getProduct({ productId }, editor);
    expect(after).toMatchObject({
      productType: stored.productType,
      legalStatus: stored.legalStatus,
      vatClass: stored.vatClass,
      ageMin: 12,
    });
    expect(after.content.find((c) => c.locale === "nl")?.name).toBe("Demo product");
  });

  it("lets the pharmacist change them, auditing the field names only", async () => {
    const { productId } = await createProductRegulated(medicine(), pharmacist);
    const stored = await getProduct({ productId }, pharmacist);
    await updateProductRegulated(
      { productId, ...medicine({ cnk: stored.cnk, vatClass: "BE_21", ageMin: 12 }) },
      pharmacist,
    );
    expect(await getProduct({ productId }, pharmacist)).toMatchObject({
      vatClass: "BE_21",
      ageMin: 12,
    });
    const audit = await auditFor(productId);
    expect(audit.map((a) => a.action)).toEqual([
      "catalog.product.created",
      "catalog.product.updated",
      "catalog.product.regulated_changed",
    ]);
    // names, not values: neither "BE_21" nor 12 appear
    expect(audit[2]?.data).toEqual({ productId, changed: "vatClass,ageMin" });
  });

  it("records no regulated change when nothing regulated changed", async () => {
    const { productId } = await createProductRegulated(medicine(), pharmacist);
    const stored = await getProduct({ productId }, pharmacist);
    await updateProductRegulated({ productId, ...medicine({ cnk: stored.cnk }) }, pharmacist);
    expect((await auditFor(productId)).map((a) => a.action)).toEqual([
      "catalog.product.created",
      "catalog.product.updated",
    ]);
  });
});

describe("activating a medicine needs a pharmacist", () => {
  it("lets an editor activate a general product but not a medicine", async () => {
    const plain = await createProduct(general(), editor);
    await setProductStatus({ productId: plain.productId, status: "active" }, editor);

    const med = await createProductRegulated(medicine(), pharmacist);
    for (const actor of [editor, owner]) {
      expect(
        await codeOf(setProductStatus({ productId: med.productId, status: "active" }, actor)),
      ).toBe(ACTIVATION);
    }
    expect((await getProduct({ productId: med.productId }, editor)).status).toBe("draft");
  });

  it("treats a legal status of otc or rx as a medicine whatever the product type (an old row)", async () => {
    const { productId } = await createProduct(general(), editor);
    await iso.sql`UPDATE catalog.products SET legal_status = 'rx' WHERE id = ${productId}`;
    expect(await codeOf(setProductStatus({ productId, status: "active" }, editor))).toBe(
      ACTIVATION,
    );
  });

  it("lets the pharmacist activate, and the editor then draft or archive the medicine", async () => {
    const { productId } = await createProductRegulated(medicine(), pharmacist);
    await setProductStatusRegulated({ productId, status: "active" }, pharmacist);
    expect((await getProduct({ productId }, editor)).status).toBe("active");
    await setProductStatus({ productId, status: "archived" }, editor); // taking it down is not regulated
    expect(await codeOf(setProductStatus({ productId, status: "active" }, editor))).toBe(
      ACTIVATION,
    );
    await setProductStatusRegulated({ productId, status: "active" }, titular);
  });

  it("keeps the content rule for the pharmacist too", async () => {
    const { productId } = await createProductRegulated(medicine({ content: [nl] }), pharmacist);
    expect(
      await codeOf(setProductStatusRegulated({ productId, status: "active" }, pharmacist)),
    ).toBe("catalog.content_missing");
  });
});

describe("only a pharmacist approves medicine text", () => {
  it("stamps the pharmacist on a regulated save", async () => {
    const { productId } = await createProductRegulated(medicine(), pharmacist);
    const rows = await approvals(productId);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.by).toBe(pharmacist.id);
      expect(row.at).toBeInstanceOf(Date);
    }
  });

  it("clears the approval of the locales an editor saves on a medicine, keeping the status", async () => {
    const { productId } = await createProductRegulated(medicine(), pharmacist);
    await setProductStatusRegulated({ productId, status: "active" }, pharmacist);
    const stored = await getProduct({ productId }, editor);
    await updateProduct(
      {
        productId,
        ...medicine({ cnk: stored.cnk, content: [{ ...nl, name: "Nieuwe naam" }, fr] }),
      },
      editor,
    );
    const rows = await approvals(productId);
    expect(rows.map((r) => [r.locale, r.by, r.at])).toEqual([
      ["fr", null, null],
      ["nl", null, null],
    ]);
    const after = await getProduct({ productId }, editor);
    expect(after.status).toBe("active");
    expect(after.content.find((c) => c.locale === "nl")?.name).toBe("Nieuwe naam");
  });

  it("re-approves when the pharmacist saves again", async () => {
    const { productId } = await createProductRegulated(medicine(), pharmacist);
    const stored = await getProduct({ productId }, editor);
    await updateProduct({ productId, ...medicine({ cnk: stored.cnk }) }, editor);
    expect((await approvals(productId)).every((r) => r.by === null)).toBe(true);
    await updateProductRegulated({ productId, ...medicine({ cnk: stored.cnk }) }, titular);
    expect((await approvals(productId)).every((r) => r.by === titular.id)).toBe(true);
  });

  it("still lets the editor approve a general product's own text (as before)", async () => {
    const { productId } = await createProduct(general(), editor);
    const rows = await approvals(productId);
    expect(rows.every((r) => r.by === editor.id)).toBe(true);
    const stored = await getProduct({ productId }, editor);
    await updateProduct({ productId, ...general({ cnk: stored.cnk }) }, owner);
    expect((await approvals(productId)).every((r) => r.by === owner.id)).toBe(true);
  });
});

describe("the inconsistent-rows report (read-only)", () => {
  it("lists exactly the products whose type and legal status disagree, and rewrites nothing", async () => {
    const mine = new Map<string, boolean>();
    for (const productType of PRODUCT_TYPES) {
      for (const legalStatus of LEGAL_STATUSES) {
        const value = cnk();
        await iso.sql`
          INSERT INTO catalog.products (id, cnk, product_type, legal_status, vat_class)
          VALUES (gen_random_uuid(), ${value}, ${productType}, ${legalStatus}, 'BE_21')`;
        mine.set(value, legalStatusFits(productType, legalStatus));
      }
    }
    const listed = (await listInconsistentProducts({}, pharmacist)).filter((p) => mine.has(p.cnk));
    expect(listed.map((p) => p.cnk).sort()).toEqual(
      [...mine]
        .filter(([, fits]) => !fits)
        .map(([value]) => value)
        .sort(),
    );
    expect(listed[0]).toEqual(
      expect.objectContaining({ productId: expect.any(String), productType: expect.any(String) }),
    );
    // read-only: every row is still there with its values
    const [count] = await iso.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM catalog.products WHERE cnk = ANY(${[...mine.keys()]})`;
    expect(count?.n).toBe(mine.size);
  });

  it("is a staff read: catalogue readers see it, customer service does not", async () => {
    await expect(listInconsistentProducts({}, assistant)).resolves.toBeInstanceOf(Array);
    await expect(listInconsistentProducts({}, editor)).resolves.toBeInstanceOf(Array);
    expect(await codeOf(listInconsistentProducts({}, staff("customer_service")))).toBe(
      "kernel.forbidden",
    );
  });

  it("does not stop an editor saving content of an old inconsistent product (values unchanged)", async () => {
    const value = cnk();
    const [row] = await iso.sql<{ id: string }[]>`
      INSERT INTO catalog.products (id, cnk, product_type, legal_status, vat_class)
      VALUES (gen_random_uuid(), ${value}, 'cosmetic', 'otc', 'BE_21') RETURNING id`;
    const productId = row?.id as string;
    await updateProduct(
      {
        productId,
        ...general({ cnk: value, productType: "cosmetic", legalStatus: "otc", content: [nl, fr] }),
      },
      editor,
    );
    expect(await getProduct({ productId }, editor)).toMatchObject({ legalStatus: "otc" });
  });
});
