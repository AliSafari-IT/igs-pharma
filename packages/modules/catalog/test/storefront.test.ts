// Storefront reads (igs-pharma#62) against real Postgres, with the RBAC catalogue loaded from the
// database: active products only, language fallback, category subtrees, and who may read.
import { randomUUID } from "node:crypto";

import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { type Actor, isDomainError } from "@igs/kernel";
import { type KernelTestHandles, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { loadRbacCatalogue } from "@igs/module-identity";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  assertSellable,
  createBrand,
  createCategory,
  createProductRegulated,
  getStorefrontProduct,
  listStorefrontCategories,
  listStorefrontProducts,
  registerAuditActions,
  setProductCategories,
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
/** Medicines and other regulated products are created and activated by a pharmacist (D-034). */
const pharmacist = staff("pharmacist");
/** The storefront's actor: a system role that can only read active products. */
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

let nextCnk = 9_600_100;
let n = 0;

interface NewProduct {
  readonly name?: string;
  readonly status?: "draft" | "active" | "archived";
  readonly brandId?: string;
  readonly productType?: "otc_medicine" | "rx_medicine" | "medical_device";
  readonly legalStatus?: "otc" | "rx" | "pharmacy_only" | "general_sale";
  readonly categoryIds?: readonly string[];
  /** Whether the pharmacist approves the text when creating it (default: yes; igs-pharma#103 gate). */
  readonly approved?: boolean;
  /** Extra content rows; Dutch and French are always written. */
  readonly content?: readonly { locale: "nl" | "fr" | "de" | "en"; name: string }[];
}

async function product(options: NewProduct = {}): Promise<{ id: string; cnk: string }> {
  const cnk = String(nextCnk++);
  const name = options.name ?? `Demo ${++n}`;
  const { productId } = await createProductRegulated(
    {
      cnk,
      // consistent on purpose: the command refuses a type/status mismatch (#79); a row from before
      // that rule is written directly below, which is what the D-034 tests need to exist
      productType: "otc_medicine",
      legalStatus: "otc",
      vatClass: "BE_6",
      ...(options.brandId ? { brandId: options.brandId } : {}),
      approveContent: options.approved ?? true,
      content: [
        {
          locale: "nl",
          name,
          shortDescription: `kort ${name}`,
          description: `lang ${name}`,
          warnings: `let op ${name}`,
        },
        { locale: "fr", name: `${name} FR`, shortDescription: `court ${name}` },
        ...(options.content ?? []),
      ],
    },
    pharmacist,
  );
  if (options.productType || options.legalStatus) {
    await iso.sql`
      UPDATE catalog.products
      SET product_type = ${options.productType ?? "otc_medicine"},
          legal_status = ${options.legalStatus ?? "otc"}
      WHERE id = ${productId}`;
  }
  if (options.categoryIds) {
    await setProductCategories({ productId, categoryIds: [...options.categoryIds] }, editor);
  }
  const status = options.status ?? "active";
  if (status !== "draft") await setProductStatusRegulated({ productId, status }, pharmacist);
  return { id: productId, cnk };
}

const category = async (parentId: string | null, base: string, extra = {}) =>
  (
    await createCategory(
      {
        parentId,
        slug: `${base.toLowerCase()}-${++n}`,
        nameNl: `${base} NL`,
        nameFr: `${base} FR`,
        ...extra,
      },
      editor,
    )
  ).categoryId;

describe("catalog.storefront.products", () => {
  it("lists only active products, by name, in the shopper's language", async () => {
    const active = await product({ name: "Bbb active" });
    await product({ name: "Aaa draft", status: "draft" });
    await product({ name: "Ccc archived", status: "archived" });
    const first = await product({ name: "Aaa active" });

    const nl = await listStorefrontProducts({ locale: "nl", pageSize: 100 }, storefront);
    const names = nl.items.map((i) => i.name);
    expect(names).not.toContain("Aaa draft");
    expect(names).not.toContain("Ccc archived");
    expect(names.indexOf("Aaa active")).toBeLessThan(names.indexOf("Bbb active"));
    expect(nl.items.find((i) => i.id === first.id)?.shortDescription).toBe("kort Aaa active");
    expect(nl.total).toBe(nl.items.length);

    const fr = await listStorefrontProducts({ locale: "fr", pageSize: 100 }, storefront);
    expect(fr.items.find((i) => i.id === active.id)?.name).toBe("Bbb active FR");
    // German has no content here: the Dutch row, with its Dutch short description
    const de = await listStorefrontProducts({ locale: "de", pageSize: 100 }, storefront);
    expect(de.items.find((i) => i.id === active.id)).toMatchObject({
      name: "Bbb active",
      shortDescription: "kort Bbb active",
    });
  });

  it("filters by a category and everything below it, and pages", async () => {
    const parent = await category(null, "Parent");
    const child = await category(parent, "Child");
    const other = await category(null, "Other");
    const inChild = await product({ categoryIds: [child] });
    const inParent = await product({ categoryIds: [parent] });
    await product({ categoryIds: [other] });
    await product({ categoryIds: [child], status: "draft" });
    const parentSlug = (await listStorefrontCategories({ locale: "nl" }, storefront)).find(
      (c) => c.id === parent,
    )?.slug as string;

    const page = await listStorefrontProducts(
      { locale: "nl", categorySlug: parentSlug, pageSize: 100 },
      storefront,
    );
    expect(page.items.map((i) => i.id).sort()).toEqual([inChild.id, inParent.id].sort());
    expect(page.category).toEqual({ slug: parentSlug, name: "Parent NL" });
    const first = await listStorefrontProducts(
      { locale: "fr", categorySlug: parentSlug, pageSize: 1 },
      storefront,
    );
    expect([first.items.length, first.total, first.category?.name]).toEqual([1, 2, "Parent FR"]);
    expect(
      await codeOf(listStorefrontProducts({ locale: "nl", categorySlug: "nope" }, storefront)),
    ).toBe("catalog.category_not_found");
  });

  it("returns the brand name", async () => {
    const { brandId } = await createBrand({ name: "Demo Brand", slug: `brand-${++n}` }, editor);
    const withBrand = await product({ brandId });
    const page = await listStorefrontProducts({ locale: "nl", pageSize: 100 }, storefront);
    expect(page.items.find((i) => i.id === withBrand.id)?.brandName).toBe("Demo Brand");
  });
});

describe("catalog.storefront.categories", () => {
  it("shows only categories with an active product in them or below, named in the language", async () => {
    const parent = await category(null, "Tree", { nameDe: "Baum DE" });
    const child = await category(parent, "Leaf");
    const empty = await category(null, "Empty");
    const draftOnly = await category(null, "Drafts");
    await product({ categoryIds: [child] });
    await product({ categoryIds: [draftOnly], status: "draft" });

    const tree = await listStorefrontCategories({ locale: "fr" }, storefront);
    const ours = tree.filter((c) => [parent, child, empty, draftOnly].includes(c.id));
    expect(ours.map((c) => [c.name, c.depth, c.productCount])).toEqual([
      ["Tree FR", 1, 1],
      ["Leaf FR", 2, 1],
    ]);
    // German falls back to Dutch where it has no name, and uses its own where it has one
    const de = (await listStorefrontCategories({ locale: "de" }, storefront)).filter((c) =>
      [parent, child].includes(c.id),
    );
    expect(de.map((c) => c.name)).toEqual(["Baum DE", "Leaf NL"]);
  });
});

describe("catalog.storefront.product", () => {
  it("returns the texts of one language, with the warnings, and its categories", async () => {
    const cat = await category(null, "Pain");
    const item = await product({ name: "Paracetamol", categoryIds: [cat] });
    const nl = await getStorefrontProduct({ cnk: item.cnk, locale: "nl" }, storefront);
    expect(nl).toMatchObject({
      id: item.id,
      name: "Paracetamol",
      description: "lang Paracetamol",
      warnings: "let op Paracetamol",
      vatClass: "BE_6",
      contentLocale: "nl",
    });
    expect(nl.categories.map((c) => c.name)).toEqual(["Pain NL"]);
    // French content exists but has no description: nothing is borrowed from the Dutch row
    const fr = await getStorefrontProduct({ cnk: item.cnk, locale: "fr" }, storefront);
    expect(fr).toMatchObject({
      name: "Paracetamol FR",
      description: null,
      warnings: null,
      contentLocale: "fr",
    });
    // English has no row: the Dutch one, flagged as Dutch
    const en = await getStorefrontProduct({ cnk: item.cnk, locale: "en" }, storefront);
    expect(en).toMatchObject({ name: "Paracetamol", contentLocale: "nl" });
  });

  it("does not know a draft, an archived or a missing product", async () => {
    const draft = await product({ status: "draft" });
    const archived = await product({ status: "archived" });
    for (const cnk of [draft.cnk, archived.cnk, "0000000"]) {
      expect(await codeOf(getStorefrontProduct({ cnk, locale: "nl" }, storefront)), cnk).toBe(
        "catalog.product_not_found",
      );
    }
  });
});

describe("who may read the storefront", () => {
  it("only the storefront role (and the owner); no other staff role holds the permission", async () => {
    for (const role of ["pharmacist", "pharmacy_assistant", "content_editor", "customer_service"]) {
      expect(await codeOf(listStorefrontProducts({ locale: "nl" }, staff(role))), role).toBe(
        "kernel.forbidden",
      );
    }
    expect(await codeOf(listStorefrontCategories({ locale: "nl" }, storefront))).toBe("ok");
    // the storefront role cannot read what staff read: drafts and the full product list
    const { listProducts } = await import("../src");
    expect(await codeOf(listProducts({}, storefront))).toBe("kernel.forbidden");
  });
});

// D-034: prescription medicines never appear on the storefront, by any read path.
describe("prescription medicines are invisible to the storefront (D-034)", () => {
  const hiddenKinds = [
    ["legal_status rx", { legalStatus: "rx" }],
    ["product_type rx_medicine", { productType: "rx_medicine" }],
    ["both", { legalStatus: "rx", productType: "rx_medicine" }],
  ] as const;

  it("keeps them out of the list, the counts, the category tree and the product page", async () => {
    const cat = await category(null, "Rxcat");
    const visible = await product({ name: "Visible otc", categoryIds: [cat] });
    const pharmacyOnly = await product({
      name: "Visible pharmacy only",
      legalStatus: "pharmacy_only",
      categoryIds: [cat],
    });
    const device = await product({
      name: "Visible device",
      productType: "medical_device",
      legalStatus: "general_sale",
      categoryIds: [cat],
    });
    const hidden = [];
    for (const [label, kind] of hiddenKinds) {
      hidden.push({
        label,
        ...(await product({ name: `Hidden ${label}`, categoryIds: [cat], ...kind })),
      });
    }
    const draft = await product({ name: "Hidden draft", categoryIds: [cat], status: "draft" });
    const archived = await product({
      name: "Hidden archived",
      categoryIds: [cat],
      status: "archived",
    });

    const tree = await listStorefrontCategories({ locale: "nl" }, storefront);
    const node = tree.find((c) => c.id === cat);
    expect(node?.productCount).toBe(3);
    const slug = node?.slug as string;

    const list = await listStorefrontProducts({ locale: "nl", pageSize: 100 }, storefront);
    const inCategory = await listStorefrontProducts(
      { locale: "nl", categorySlug: slug, pageSize: 100 },
      storefront,
    );
    for (const page of [list, inCategory]) {
      const ids = page.items.map((i) => i.id);
      for (const h of [...hidden, draft, archived]) expect(ids).not.toContain(h.id);
      for (const v of [visible, pharmacyOnly, device]) expect(ids).toContain(v.id);
    }
    expect(inCategory.total).toBe(3);

    // a category that holds only Rx products is not in the tree at all
    const rxOnly = await category(null, "Rxonly");
    await product({ legalStatus: "rx", categoryIds: [rxOnly] });
    expect(
      (await listStorefrontCategories({ locale: "nl" }, storefront)).map((c) => c.id),
    ).not.toContain(rxOnly);

    // a direct CNK lookup is the same "not found" as an unknown CNK
    for (const h of [...hidden, draft, archived]) {
      expect(await codeOf(getStorefrontProduct({ cnk: h.cnk, locale: "nl" }, storefront))).toBe(
        "catalog.product_not_found",
      );
    }
    for (const v of [visible, pharmacyOnly, device]) {
      expect(await codeOf(getStorefrontProduct({ cnk: v.cnk, locale: "nl" }, storefront))).toBe(
        "ok",
      );
    }
  });

  it("assertSellable rejects what the storefront must not show, like a missing product", async () => {
    const ok = await product({});
    const pharmacyOnly = await product({ legalStatus: "pharmacy_only" });
    const rx = await product({ legalStatus: "rx" });
    const rxType = await product({ productType: "rx_medicine" });
    const draft = await product({ status: "draft" });
    const ids = [rx.id, rxType.id, draft.id, randomUUID()];
    const check = (id: string) => codeOf(iso.db.transaction((tx) => assertSellable(tx, id)));
    expect(await check(ok.id)).toBe("ok");
    expect(await check(pharmacyOnly.id)).toBe("ok");
    for (const id of ids) expect(await check(id)).toBe("catalog.product_not_sellable");
  });
});

describe("a category with nothing the storefront may show does not exist (D-034)", () => {
  const slugOf = async (id: string) =>
    (await iso.sql<{ slug: string }[]>`SELECT slug FROM catalog.categories WHERE id = ${id}`)[0]
      ?.slug as string;
  const notFoundCode = (slug: string) =>
    codeOf(listStorefrontProducts({ locale: "nl", categorySlug: slug }, storefront));

  it("gives an Rx-only, a draft-only, an archived-only and an empty category the same error as an unknown slug", async () => {
    const rxOnly = await category(null, "Antibioticsrx");
    const draftOnly = await category(null, "Draftonly");
    const archivedOnly = await category(null, "Archivedonly");
    const empty = await category(null, "Emptycat");
    await product({ legalStatus: "rx", categoryIds: [rxOnly] });
    await product({ productType: "rx_medicine", categoryIds: [rxOnly] });
    await product({ status: "draft", categoryIds: [draftOnly] });
    await product({ status: "archived", categoryIds: [archivedOnly] });

    const unknown = await notFoundCode("does-not-exist");
    expect(unknown).toBe("catalog.category_not_found");
    for (const id of [rxOnly, draftOnly, archivedOnly, empty]) {
      expect(await notFoundCode(await slugOf(id)), id).toBe(unknown);
    }
  });

  it("still shows a category that has a visible product next to hidden ones", async () => {
    const mixed = await category(null, "Mixedcat");
    const visible = await product({ categoryIds: [mixed] });
    await product({ legalStatus: "rx", categoryIds: [mixed] });
    const page = await listStorefrontProducts(
      { locale: "nl", categorySlug: await slugOf(mixed) },
      storefront,
    );
    expect(page.items.map((i) => i.id)).toEqual([visible.id]);
    expect(page.total).toBe(1);
  });

  it("shows a parent whose only visible product is in a nested child, and hides the child that has none", async () => {
    const parent = await category(null, "Nestedparent");
    const visibleChild = await category(parent, "Visiblechild");
    const hiddenChild = await category(parent, "Hiddenchild");
    const visible = await product({ categoryIds: [visibleChild] });
    await product({ legalStatus: "rx", categoryIds: [hiddenChild] });

    const page = await listStorefrontProducts(
      { locale: "nl", categorySlug: await slugOf(parent) },
      storefront,
    );
    expect(page.items.map((i) => i.id)).toEqual([visible.id]);
    expect(await notFoundCode(await slugOf(hiddenChild))).toBe("catalog.category_not_found");
    expect(
      await codeOf(
        listStorefrontProducts(
          { locale: "nl", categorySlug: await slugOf(visibleChild) },
          storefront,
        ),
      ),
    ).toBe("ok");
  });
});
