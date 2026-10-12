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
  createBrand,
  createCategory,
  createProduct,
  getStorefrontProduct,
  listStorefrontCategories,
  listStorefrontProducts,
  registerAuditActions,
  setProductCategories,
  setProductStatus,
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
  readonly categoryIds?: readonly string[];
  /** Extra content rows; Dutch and French are always written. */
  readonly content?: readonly { locale: "nl" | "fr" | "de" | "en"; name: string }[];
}

async function product(options: NewProduct = {}): Promise<{ id: string; cnk: string }> {
  const cnk = String(nextCnk++);
  const name = options.name ?? `Demo ${++n}`;
  const { productId } = await createProduct(
    {
      cnk,
      productType: "otc_medicine",
      legalStatus: "otc",
      vatClass: "BE_6",
      ...(options.brandId ? { brandId: options.brandId } : {}),
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
    editor,
  );
  if (options.categoryIds) {
    await setProductCategories({ productId, categoryIds: [...options.categoryIds] }, editor);
  }
  const status = options.status ?? "active";
  if (status !== "draft") await setProductStatus({ productId, status }, editor);
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
