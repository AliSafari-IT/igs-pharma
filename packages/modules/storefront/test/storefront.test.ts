// The storefront read model (igs-pharma#103) against real Postgres: the approved-content gate, search,
// filters, sorts, pagination, availability, the category counts and the back-office explanation, with
// the RBAC catalogue loaded from the database and the real audit port.
import { randomUUID } from "node:crypto";

import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { type Actor, isDomainError } from "@igs/kernel";
import { configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import {
  createBrand,
  createCategory,
  createProduct,
  createProductRegulated,
  foldSearch,
  registerAuditActions as registerCatalogAudit,
  setProductCategories,
  setProductStatus,
  setProductStatusRegulated,
  updateProduct,
  updateProductRegulated,
} from "@igs/module-catalog";
import { loadRbacCatalogue } from "@igs/module-identity";
import { adjustStock, registerAuditActions as registerInventoryAudit } from "@igs/module-inventory";
import { registerAuditActions as registerPricingAudit, setPrice } from "@igs/module-pricing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  type ListInput,
  configureStorefront,
  getStorefrontProduct,
  listStorefrontCategories,
  listStorefrontProducts,
  productVisibility,
} from "../src";

let iso: IsolatedDatabase;

beforeAll(async () => {
  iso = await createIsolatedDatabase();
  await loadRbacCatalogue(iso.db);
  registerCatalogAudit(registerAuditAction);
  registerInventoryAudit(registerAuditAction);
  registerPricingAudit(registerAuditAction);
});
afterAll(async () => {
  await iso?.drop();
});
beforeEach(() => {
  const kernel = configureKernelForTests({ db: iso.db, audit: createAuditPort() });
  kernel.clock.set(new Date());
  configureStorefront({}); // the default low-stock threshold (3)
});

const staff = (...roles: string[]): Actor => ({
  type: "user",
  id: randomUUID(),
  roles,
  kind: "staff",
  mfaVerified: true,
});
const owner = staff("owner");
const editor = staff("content_editor");
const pharmacist = staff("pharmacist");
const storefront: Actor = { type: "system", id: "storefront", roles: ["system_storefront"] };

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "ok";
};

let nextCnk = 9_700_100;

interface Spec {
  readonly name: string;
  readonly short?: string;
  /** A medicine needs approved text to be visible; default: a general product. */
  readonly medicine?: boolean;
  /** Medicines: whether the pharmacist approves the text when creating it (default true). */
  readonly approved?: boolean;
  readonly status?: "draft" | "active" | "archived";
  /** Euro cents; `null`: no price. Default 500. */
  readonly cents?: number | null;
  /** On hand; default 10. */
  readonly stock?: number;
  readonly brandId?: string;
  readonly categoryIds?: readonly string[];
  readonly extra?: readonly { locale: "nl" | "fr" | "de" | "en"; name: string }[];
  readonly createdAt?: Date;
}

interface Made {
  readonly id: string;
  readonly cnk: string;
  readonly version: number;
  readonly name: string;
}

async function make(spec: Spec): Promise<Made> {
  const cnk = String(nextCnk++);
  const content = [
    {
      locale: "nl" as const,
      name: spec.name,
      ...(spec.short ? { shortDescription: spec.short } : {}),
    },
    { locale: "fr" as const, name: `${spec.name} FR` },
    ...(spec.extra ?? []),
  ];
  const created = spec.medicine
    ? await createProductRegulated(
        {
          cnk,
          productType: "otc_medicine",
          legalStatus: "otc",
          vatClass: "BE_6",
          approveContent: spec.approved ?? true,
          ...(spec.brandId ? { brandId: spec.brandId } : {}),
          content,
        },
        pharmacist,
      )
    : await createProduct(
        {
          cnk,
          productType: "general",
          legalStatus: "general_sale",
          vatClass: "BE_21",
          ...(spec.brandId ? { brandId: spec.brandId } : {}),
          content,
        },
        editor,
      );
  const id = created.productId;
  if (spec.categoryIds) {
    await setProductCategories({ productId: id, categoryIds: [...spec.categoryIds] }, editor);
  }
  const status = spec.status ?? "active";
  if (status !== "draft") {
    if (spec.medicine) await setProductStatusRegulated({ productId: id, status }, pharmacist);
    else await setProductStatus({ productId: id, status }, editor);
  }
  const cents = spec.cents === undefined ? 500 : spec.cents;
  if (cents !== null) await setPrice({ productId: id, amountCents: cents }, owner);
  const stock = spec.stock ?? 10;
  if (stock > 0) {
    await adjustStock({ productId: id, delta: stock, reason: "adjustment", note: "test" }, owner);
  }
  if (spec.createdAt) {
    await iso.sql`UPDATE catalog.products SET created_at = ${spec.createdAt.toISOString()}::timestamptz WHERE id = ${id}`;
  }
  return { id, cnk, version: created.version, name: spec.name };
}

const category = async (parentId: string | null, slug: string, name = slug) =>
  (
    await createCategory(
      { parentId, slug, nameNl: name, nameFr: `${name} FR`, nameEn: `${name} EN` },
      editor,
    )
  ).categoryId;

/** Every product the storefront lists for `input`, over all pages. */
async function everything(input: ListInput = { locale: "nl" }) {
  const seen = [];
  for (let page = 1; ; page++) {
    const result = await listStorefrontProducts({ ...input, page, pageSize: 48 }, storefront);
    seen.push(...result.items);
    if (page >= result.pageCount) return seen;
  }
}
const names = async (input: ListInput) => (await everything(input)).map((i) => i.name);

// A unique marker in every name of one test, so tests do not see each other's products.
const marker = () => `m${randomUUID().slice(0, 8)}`;

const versionOf = async (productId: string) =>
  (
    await iso.sql<
      { version: number }[]
    >`SELECT version FROM catalog.products WHERE id = ${productId}`
  )[0]?.version ?? 0;

describe("the approved-content gate for medicines (D-034)", () => {
  it("a medicine is on the shop only while a pharmacist has approved its Dutch AND French text", async () => {
    const tag = marker();
    const med = await make({ name: `${tag} Paracetamol`, medicine: true, approved: false });
    const seen = async () => await names({ locale: "nl", q: tag });

    // created by a pharmacist but not approved: absent from the list, the page, and the counts
    expect(await seen()).toEqual([]);
    expect(await codeOf(getStorefrontProduct({ cnk: med.cnk, locale: "nl" }, storefront))).toBe(
      "catalog.product_not_found",
    );
    expect(await productVisibility({ productId: med.id }, pharmacist)).toEqual({
      visible: false,
      reasons: [{ code: "text_not_approved", locales: ["nl", "fr"] }],
    });

    // a pharmacist approves the text
    await updateProductRegulated(
      {
        productId: med.id,
        expectedVersion: await versionOf(med.id),
        cnk: med.cnk,
        productType: "otc_medicine",
        legalStatus: "otc",
        vatClass: "BE_6",
        approveContent: true,
        content: [
          { locale: "nl", name: `${tag} Paracetamol` },
          { locale: "fr", name: `${tag} Paracetamol FR` },
        ],
      },
      pharmacist,
    );
    expect(await seen()).toEqual([`${tag} Paracetamol`]);
    expect(
      (await getStorefrontProduct({ cnk: med.cnk, locale: "nl" }, storefront)).isMedicine,
    ).toBe(true);
    expect(await productVisibility({ productId: med.id }, pharmacist)).toEqual({
      visible: true,
      reasons: [],
    });

    // an EDITOR changes the text: the changed locale is unapproved again and the medicine disappears
    await updateProduct(
      {
        productId: med.id,
        expectedVersion: await versionOf(med.id),
        cnk: med.cnk,
        productType: "otc_medicine",
        legalStatus: "otc",
        vatClass: "BE_6",
        content: [
          { locale: "nl", name: `${tag} Paracetamol 500 mg` },
          { locale: "fr", name: `${tag} Paracetamol FR` },
        ],
      },
      editor,
    );
    expect(await seen()).toEqual([]);
    expect(await productVisibility({ productId: med.id }, pharmacist)).toEqual({
      visible: false,
      reasons: [{ code: "text_not_approved", locales: ["nl"] }],
    });
  });

  it("needs BOTH required locales: only Dutch approved is hidden", async () => {
    const tag = marker();
    const med = await make({ name: `${tag} Ibuprofen`, medicine: true });
    expect(await names({ locale: "nl", q: tag })).toEqual([`${tag} Ibuprofen`]);
    await iso.sql`UPDATE catalog.product_content SET approved_by = NULL, approved_at = NULL WHERE product_id = ${med.id} AND locale = 'fr'`;
    expect(await names({ locale: "nl", q: tag })).toEqual([]);
    expect(await names({ locale: "fr", q: tag })).toEqual([]); // the rule does not depend on the shopper's language
    expect((await productVisibility({ productId: med.id }, pharmacist)).reasons).toEqual([
      { code: "text_not_approved", locales: ["fr"] },
    ]);
  });

  it("an unapproved German text falls back to the approved Dutch text, never a mix", async () => {
    const tag = marker();
    const med = await make({
      name: `${tag} Hoestsiroop`,
      medicine: true,
      extra: [{ locale: "de", name: `${tag} Hustensaft` }],
    });
    // German approved with the rest: the German row is shown
    const de = await listStorefrontProducts({ locale: "de", q: tag }, storefront);
    expect(de.items.map((i) => [i.name, i.contentLocale])).toEqual([[`${tag} Hustensaft`, "de"]]);
    await iso.sql`UPDATE catalog.product_content SET approved_by = NULL WHERE product_id = ${med.id} AND locale = 'de'`;
    const fallback = await listStorefrontProducts({ locale: "de", q: tag }, storefront);
    expect(fallback.items.map((i) => [i.name, i.contentLocale])).toEqual([
      [`${tag} Hoestsiroop`, "nl"],
    ]);
    const page = await getStorefrontProduct({ cnk: med.cnk, locale: "de" }, storefront);
    expect([page.name, page.contentLocale]).toEqual([`${tag} Hoestsiroop`, "nl"]);
  });

  it("does not touch products that are not medicines: their text needs no approval", async () => {
    const tag = marker();
    const care = await make({ name: `${tag} Zeep` });
    await iso.sql`UPDATE catalog.product_content SET approved_by = NULL, approved_at = NULL WHERE product_id = ${care.id}`;
    expect(await names({ locale: "nl", q: tag })).toEqual([`${tag} Zeep`]);
    expect(
      (await getStorefrontProduct({ cnk: care.cnk, locale: "nl" }, storefront)).isMedicine,
    ).toBe(false);
  });

  it("a medicine disappears from the category counts and from pricing and stock answers too", async () => {
    const tag = marker();
    const root = await category(null, `gate-${tag}`);
    const med = await make({ name: `${tag} Med`, medicine: true, categoryIds: [root] });
    const tree = async () =>
      (await listStorefrontCategories({ locale: "nl" }, storefront)).filter(
        (c) => c.slug === `gate-${tag}`,
      );
    expect(await tree()).toHaveLength(1);
    await iso.sql`UPDATE catalog.product_content SET approved_by = NULL WHERE product_id = ${med.id}`;
    expect(await tree()).toEqual([]);
    expect(
      await codeOf(
        listStorefrontProducts({ locale: "nl", categorySlug: `gate-${tag}` }, storefront),
      ),
    ).toBe("catalog.category_not_found");
  });
});

describe("what the shop may show at all", () => {
  it("hides drafts, archived products, prescription products and unpriced products, and says why", async () => {
    const tag = marker();
    const shown = await make({ name: `${tag} zichtbaar` });
    const draft = await make({ name: `${tag} concept`, status: "draft" });
    const archived = await make({ name: `${tag} archief`, status: "archived" });
    const unpriced = await make({ name: `${tag} zonder prijs`, cents: null });
    const rx = await make({ name: `${tag} rx` });
    await iso.sql`UPDATE catalog.products SET legal_status = 'rx', product_type = 'rx_medicine' WHERE id = ${rx.id}`;
    expect(await names({ locale: "nl", q: tag })).toEqual([`${tag} zichtbaar`]);

    const why = async (id: string) =>
      (await productVisibility({ productId: id }, pharmacist)).reasons;
    expect(await why(shown.id)).toEqual([]);
    expect(await why(draft.id)).toEqual([{ code: "draft" }]);
    expect(await why(archived.id)).toEqual([{ code: "archived" }]);
    expect(await why(unpriced.id)).toEqual([{ code: "no_price" }]);
    expect(await why(rx.id)).toEqual([{ code: "prescription_only" }]);
    for (const hidden of [draft, archived, unpriced, rx]) {
      expect(
        await codeOf(getStorefrontProduct({ cnk: hidden.cnk, locale: "nl" }, storefront)),
      ).toBe("catalog.product_not_found");
    }
  });

  it("lists several reasons at once", async () => {
    const tag = marker();
    const both = await make({
      name: `${tag} x`,
      status: "draft",
      cents: null,
      medicine: true,
      approved: false,
    });
    expect((await productVisibility({ productId: both.id }, pharmacist)).reasons).toEqual([
      { code: "draft" },
      { code: "text_not_approved", locales: ["nl", "fr"] },
      { code: "no_price" },
    ]);
  });

  it("the explanation agrees with the listing for every combination", async () => {
    const tag = marker();
    const combos: Spec[] = [];
    for (const status of ["draft", "active", "archived"] as const) {
      for (const cents of [null, 700]) {
        for (const medicine of [false, true]) {
          for (const approved of [true, false]) {
            if (!medicine && !approved) continue;
            combos.push({
              name: `${tag} ${status} ${cents ?? "geen"} ${medicine ? "med" : "zorg"} ${approved}`,
              status,
              cents,
              medicine,
              approved,
            });
          }
        }
      }
    }
    const made: Made[] = [];
    for (const spec of combos) made.push(await make(spec));
    const listed = new Set((await everything({ locale: "nl", q: tag })).map((i) => i.id));
    for (const product of made) {
      const answer = await productVisibility({ productId: product.id }, pharmacist);
      expect(answer.visible, product.name).toBe(listed.has(product.id));
      expect(answer.visible, product.name).toBe(answer.reasons.length === 0);
    }
    expect(listed.size).toBe(2); // only an active, priced care product and an active, priced, approved medicine
  });

  it("the back-office explanation is for staff only", async () => {
    const tag = marker();
    const p = await make({ name: `${tag} x` });
    expect(await codeOf(productVisibility({ productId: p.id }, storefront))).toBe(
      "kernel.forbidden",
    );
    expect(await codeOf(productVisibility({ productId: randomUUID() }, pharmacist))).toBe(
      "catalog.product_not_found",
    );
  });
});

describe("search", () => {
  it("ignores case and accents, in the name and the short description", async () => {
    const tag = marker();
    await make({ name: `${tag} Crème hydratante`, short: "Pour les mains" });
    await make({ name: `${tag} Zalf`, short: "Voor droge huid, ÉCZÉMA" });
    for (const q of [`${tag} creme`, `${tag} CRÈME`, `${tag} hydrat`]) {
      expect(await names({ locale: "nl", q }), q).toEqual([`${tag} Crème hydratante`]);
    }
    expect(await names({ locale: "nl", q: `${tag} eczema` })).toEqual([`${tag} Zalf`]);
  });

  it("needs every word (AND) and also matches the brand", async () => {
    const tag = marker();
    const brand = await createBrand({ name: `Marque${tag}`, slug: `marque-${tag}` }, editor);
    await make({ name: `${tag} Shampoo anti roos`, brandId: brand.brandId });
    await make({ name: `${tag} Shampoo kinderen` });
    expect(await names({ locale: "nl", q: `${tag} shampoo roos` })).toEqual([
      `${tag} Shampoo anti roos`,
    ]);
    expect(await names({ locale: "nl", q: `shampoo marque${tag}` })).toEqual([
      `${tag} Shampoo anti roos`,
    ]);
    expect(await names({ locale: "nl", q: `${tag} shampoo` })).toHaveLength(2);
  });

  it("an exact 7-digit CNK returns that product", async () => {
    const tag = marker();
    const p = await make({ name: `${tag} Pleisters` });
    await make({ name: `${tag} Verband` });
    const found = await listStorefrontProducts({ locale: "nl", q: p.cnk }, storefront);
    expect(found.items.map((i) => i.cnk)).toEqual([p.cnk]);
    expect(found.total).toBe(1);
  });

  it("searches the shopper's language, with Dutch as the fallback", async () => {
    const tag = marker();
    await make({ name: `${tag} Pleister` }); // French row: "<name> FR"
    expect(await names({ locale: "fr", q: `${tag} pleister fr` })).toEqual([`${tag} Pleister FR`]);
    expect(await names({ locale: "nl", q: `${tag} pleister fr` })).toEqual([]);
    // German has no row: Dutch is shown and searched
    const de = await listStorefrontProducts({ locale: "de", q: `${tag} pleister` }, storefront);
    expect(de.items.map((i) => [i.name, i.contentLocale])).toEqual([[`${tag} Pleister`, "nl"]]);
  });

  it("treats % _ and \\ literally", async () => {
    const tag = marker();
    await make({ name: `${tag} 100% natuur` });
    await make({ name: `${tag} 100 procent` });
    await make({ name: `${tag} a_b` });
    await make({ name: `${tag} aXb` });
    expect(await names({ locale: "nl", q: `${tag} 100%` })).toEqual([`${tag} 100% natuur`]);
    expect(await names({ locale: "nl", q: `${tag} a_b` })).toEqual([`${tag} a_b`]);
    expect(await names({ locale: "nl", q: "%%" })).toEqual([]);
    expect(await names({ locale: "nl", q: "\\\\" })).toEqual([]);
  });

  it("refuses a one-character query and an over-long one", async () => {
    expect(await codeOf(listStorefrontProducts({ locale: "nl", q: "a" }, storefront))).toBe(
      "kernel.validation_failed",
    );
    expect(
      await codeOf(listStorefrontProducts({ locale: "nl", q: "x".repeat(101) }, storefront)),
    ).toBe("kernel.validation_failed");
  });

  it("folds œ æ ß explicitly: they are NOT expanded (documented decision)", async () => {
    const tag = marker();
    await make({ name: `${tag} Straße`, short: "œuvre æther" });
    expect(await names({ locale: "nl", q: `${tag} strasse` })).toEqual([]);
    expect(await names({ locale: "nl", q: `${tag} straße` })).toEqual([`${tag} Straße`]);
    expect(await names({ locale: "nl", q: `${tag} oeuvre` })).toEqual([]);
    expect(await names({ locale: "nl", q: `${tag} œuvre` })).toEqual([`${tag} Straße`]);
  });

  it("the database column folds exactly like the application does", async () => {
    const tag = marker();
    const samples = [
      `${tag} Crème brûlée ÀÉÎÕÜ çñ`,
      `${tag} Łódź Đakovo Ťažký Œuvre Straße Æsir`,
      `${tag} plain ASCII 123 %_\\`,
    ];
    for (const name of samples) await make({ name, short: "Ångström ŠČŘŽÝ" });
    const rows = await iso.sql<
      { name: string; short_description: string | null; search_text: string }[]
    >`
      SELECT name, short_description, search_text FROM catalog.product_content WHERE locale = 'nl' AND name LIKE ${`${tag}%`}`;
    expect(rows).toHaveLength(samples.length);
    for (const row of rows) {
      expect(row.search_text).toBe(foldSearch(`${row.name} ${row.short_description ?? ""}`));
    }
  });

  it("ranks an exact CNK first, then names that start with the query, then contain it", async () => {
    const tag = marker();
    await make({ name: `${tag} extra zink` });
    await make({ name: `${tag} Zinkzalf` });
    await make({ name: `Zink ${tag}` });
    const order = await names({ locale: "nl", q: `zink ${tag}`, sort: "relevance" });
    expect(order[0]).toBe(`Zink ${tag}`);
  });
});

describe("filters, sorts and pages", () => {
  it("filters by a category and everything below it", async () => {
    const tag = marker();
    const parent = await category(null, `p-${tag}`);
    const child = await category(parent, `c-${tag}`);
    await make({ name: `${tag} in parent`, categoryIds: [parent] });
    await make({ name: `${tag} in child`, categoryIds: [child] });
    await make({ name: `${tag} elsewhere` });
    expect(await names({ locale: "nl", categorySlug: `p-${tag}` })).toEqual([
      `${tag} in child`,
      `${tag} in parent`,
    ]);
    expect(await names({ locale: "nl", categorySlug: `c-${tag}` })).toEqual([`${tag} in child`]);
    const page = await listStorefrontProducts(
      { locale: "fr", categorySlug: `c-${tag}` },
      storefront,
    );
    expect(page.category).toEqual({ slug: `c-${tag}`, name: `c-${tag} FR` });
    expect(
      await codeOf(listStorefrontProducts({ locale: "nl", categorySlug: "nope" }, storefront)),
    ).toBe("catalog.category_not_found");
  });

  it("sorts by name, price (both ways) and latest, with a stable tie-breaker", async () => {
    const tag = marker();
    const cat = await category(null, `s-${tag}`);
    await make({
      name: `${tag} b`,
      cents: 300,
      categoryIds: [cat],
      createdAt: new Date("2026-01-03T00:00:00Z"),
    });
    await make({
      name: `${tag} a`,
      cents: 900,
      categoryIds: [cat],
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    await make({
      name: `${tag} c`,
      cents: 300,
      categoryIds: [cat],
      createdAt: new Date("2026-01-02T00:00:00Z"),
    });
    const sorted = (sort: "name" | "price_asc" | "price_desc" | "latest") =>
      names({ locale: "nl", categorySlug: `s-${tag}`, sort });
    expect(await sorted("name")).toEqual([`${tag} a`, `${tag} b`, `${tag} c`]);
    expect(await sorted("price_asc")).toEqual([`${tag} b`, `${tag} c`, `${tag} a`]);
    expect(await sorted("price_desc")).toEqual([`${tag} a`, `${tag} b`, `${tag} c`]);
    expect(await sorted("latest")).toEqual([`${tag} b`, `${tag} c`, `${tag} a`]);
  });

  it("pages are stable and complete: the union of the pages is the set, with no repeats", async () => {
    const tag = marker();
    const cat = await category(null, `pg-${tag}`);
    for (let i = 0; i < 11; i++)
      await make({ name: `${tag} Zelfde`, cents: 100 + (i % 3), categoryIds: [cat] });
    for (const sort of ["name", "price_asc", "price_desc", "latest"] as const) {
      const ids: string[] = [];
      for (let page = 1; page <= 3; page++) {
        const result = await listStorefrontProducts(
          { locale: "nl", categorySlug: `pg-${tag}`, sort, page, pageSize: 4 },
          storefront,
        );
        expect([result.total, result.pageCount]).toEqual([11, 3]);
        ids.push(...result.items.map((i) => i.id));
      }
      expect(new Set(ids).size, sort).toBe(11);
    }
    const past = await listStorefrontProducts(
      { locale: "nl", categorySlug: `pg-${tag}`, page: 9, pageSize: 4 },
      storefront,
    );
    expect([past.items, past.total, past.page]).toEqual([[], 11, 9]);
  });

  it("returns the price with its VAT class and rate, never a stock count", async () => {
    const tag = marker();
    const p = await make({ name: `${tag} x`, cents: 1234 });
    const med = await make({ name: `${tag} med`, medicine: true, cents: 799 });
    const page = await listStorefrontProducts(
      { locale: "nl", q: tag, sort: "price_asc" },
      storefront,
    );
    expect(page.items.map((i) => i.price)).toEqual([
      { amountCents: 799, vatClass: "BE_6", vatRateBp: 600 },
      { amountCents: 1234, vatClass: "BE_21", vatRateBp: 2100 },
    ]);
    expect(page.items.map((i) => i.isMedicine)).toEqual([true, false]);
    expect(JSON.stringify(page)).not.toMatch(/onHand|stock|quantity/i);
    expect(p.id).not.toBe(med.id);
  });
});

describe("availability", () => {
  it("is available, low or out by the configured threshold, and never a number", async () => {
    const tag = marker();
    await make({ name: `${tag} 0`, stock: 0 });
    await make({ name: `${tag} 1`, stock: 1 });
    await make({ name: `${tag} 3`, stock: 3 });
    await make({ name: `${tag} 4`, stock: 4 });
    const statuses = async () =>
      Object.fromEntries(
        (await everything({ locale: "nl", q: tag })).map((i) => [i.name.slice(-1), i.status]),
      );
    expect(await statuses()).toEqual({ "0": "out", "1": "low", "3": "low", "4": "available" });
    configureStorefront({ lowStockThreshold: 0 });
    expect(await statuses()).toEqual({
      "0": "out",
      "1": "available",
      "3": "available",
      "4": "available",
    });
    configureStorefront({ lowStockThreshold: 10 });
    expect(await statuses()).toEqual({ "0": "out", "1": "low", "3": "low", "4": "low" });
    expect(() => configureStorefront({ lowStockThreshold: 51 })).toThrow();
    expect(() => configureStorefront({ lowStockThreshold: -1 })).toThrow();
  });

  it("filters to what is in stock and counts only those", async () => {
    const tag = marker();
    await make({ name: `${tag} a`, stock: 0 });
    await make({ name: `${tag} b`, stock: 2 });
    await make({ name: `${tag} c`, stock: 9 });
    const page = await listStorefrontProducts(
      { locale: "nl", q: tag, availability: "in_stock" },
      storefront,
    );
    expect(page.items.map((i) => i.name)).toEqual([`${tag} b`, `${tag} c`]);
    expect(page.total).toBe(2);
  });

  it("follows the stock as it moves (the same level the ledger maintains)", async () => {
    const tag = marker();
    const p = await make({ name: `${tag} x`, stock: 5 });
    const status = async () =>
      (await getStorefrontProduct({ cnk: p.cnk, locale: "nl" }, storefront)).status;
    expect(await status()).toBe("available");
    await adjustStock({ productId: p.id, delta: -3, reason: "adjustment", note: "sold" }, owner);
    expect(await status()).toBe("low");
    await adjustStock({ productId: p.id, delta: -2, reason: "adjustment", note: "sold" }, owner);
    expect(await status()).toBe("out");
  });
});

describe("the product page and the category tree", () => {
  it("returns the texts of one language row, the warnings, the breadcrumb and the categories", async () => {
    const tag = marker();
    const root = await category(null, `bc-${tag}`, `Root ${tag}`);
    const leaf = await category(root, `leaf-${tag}`, `Leaf ${tag}`);
    const p = await make({ name: `${tag} Zalf`, short: "kort", categoryIds: [leaf] });
    const page = await getStorefrontProduct({ cnk: p.cnk, locale: "fr" }, storefront);
    expect(page.name).toBe(`${tag} Zalf FR`);
    expect(page.breadcrumb).toEqual([
      { slug: `bc-${tag}`, name: `Root ${tag} FR` },
      { slug: `leaf-${tag}`, name: `Leaf ${tag} FR` },
    ]);
    expect(page.categories).toEqual([{ slug: `leaf-${tag}`, name: `Leaf ${tag} FR` }]);
    expect(page.price.amountCents).toBe(500);
    expect(page.topCategory).toEqual({ slug: `bc-${tag}`, name: `Root ${tag} FR` });
  });

  it("a list item's top category is the root of its deepest category, as on its page", async () => {
    const tag = marker();
    const shallow = await category(null, `ts-${tag}`, `Shallow ${tag}`);
    const deepRoot = await category(null, `td-${tag}`, `Deep ${tag}`);
    const deepMid = await category(deepRoot, `td-m-${tag}`);
    const deepLeaf = await category(deepMid, `td-l-${tag}`);
    // in a top-level category and a third-level one: the deeper path wins, whatever the link order
    const both = await make({ name: `${tag} 1 both`, categoryIds: [shallow, deepLeaf] });
    const top = await make({ name: `${tag} 2 top`, categoryIds: [shallow] });
    const none = await make({ name: `${tag} 3 none` });
    const page = await listStorefrontProducts({ locale: "fr", q: tag }, storefront);
    expect(page.items.map((i) => [i.cnk, i.topCategory])).toEqual([
      [both.cnk, { slug: `td-${tag}`, name: `Deep ${tag} FR` }],
      [top.cnk, { slug: `ts-${tag}`, name: `Shallow ${tag} FR` }],
      [none.cnk, null],
    ]);
    for (const item of page.items) {
      const detail = await getStorefrontProduct({ cnk: item.cnk, locale: "fr" }, storefront);
      expect(detail.topCategory, item.cnk).toEqual(item.topCategory);
      expect(detail.breadcrumb[0] ?? null, item.cnk).toEqual(item.topCategory);
    }
  });

  it("counts only visible, priced products (a product in two categories counts once per ancestor)", async () => {
    const tag = marker();
    const root = await category(null, `cnt-${tag}`);
    const a = await category(root, `cnt-a-${tag}`);
    const b = await category(root, `cnt-b-${tag}`);
    await make({ name: `${tag} 1`, categoryIds: [a] });
    await make({ name: `${tag} 2`, categoryIds: [a, b] });
    await make({ name: `${tag} unpriced`, categoryIds: [b], cents: null });
    await make({ name: `${tag} draft`, categoryIds: [b], status: "draft" });
    const tree = (await listStorefrontCategories({ locale: "nl" }, storefront)).filter((c) =>
      c.slug.endsWith(tag),
    );
    expect(tree.map((c) => [c.slug, c.depth, c.productCount])).toEqual([
      [`cnt-${tag}`, 1, 2],
      [`cnt-a-${tag}`, 2, 2],
      [`cnt-b-${tag}`, 2, 1],
    ]);
  });
});

describe("who may read", () => {
  it("the listing, the page and the tree need the storefront permission", async () => {
    const nobody: Actor = { type: "system", id: "nobody", roles: [] };
    expect(await codeOf(listStorefrontProducts({ locale: "nl" }, nobody))).toBe("kernel.forbidden");
    expect(await codeOf(getStorefrontProduct({ cnk: "9900000", locale: "nl" }, nobody))).toBe(
      "kernel.forbidden",
    );
    expect(await codeOf(listStorefrontCategories({ locale: "nl" }, nobody))).toBe(
      "kernel.forbidden",
    );
    expect(await codeOf(listStorefrontProducts({ locale: "nl" }, storefront))).toBe("ok");
  });
});
