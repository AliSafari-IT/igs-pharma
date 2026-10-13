// Categories (igs-pharma#54) against real Postgres, with the RBAC catalogue loaded from the database
// and the real audit port: the tree rules, product links, permissions and audit shapes.
import { randomUUID } from "node:crypto";

import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { type Actor, isDomainError } from "@igs/kernel";
import { type KernelTestHandles, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { loadRbacCatalogue } from "@igs/module-identity";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  type CategoryNode,
  MAX_CATEGORY_DEPTH,
  createCategory,
  createProduct,
  deleteCategory,
  getProduct,
  listCategories,
  moveCategory,
  registerAuditActions,
  setProductCategories,
  updateCategory,
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

let n = 0;
const slug = (base = "cat") => `${base}-${++n}`;

const category = async (parentId: string | null = null, base?: string) =>
  (
    await createCategory(
      { parentId, slug: slug(base), nameNl: `Categorie ${n}`, nameFr: `Catégorie ${n}` },
      editor,
    )
  ).categoryId;

let nextCnk = 9_800_100;
const product = async () =>
  (
    await createProduct(
      {
        cnk: String(nextCnk++),
        productType: "otc_medicine",
        legalStatus: "otc",
        vatClass: "BE_6",
        content: [{ locale: "nl", name: "Demo product" }],
      },
      editor,
    )
  ).productId;

/** The row's current version, as an edit form would have loaded it (igs-pharma#80). */
const cv = async (id: string) =>
  (await iso.sql<{ version: number }[]>`SELECT version FROM catalog.categories WHERE id = ${id}`)[0]
    ?.version as number;

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
  iso.sql<{ action: string; data: Record<string, unknown> }[]>`
    SELECT action, data FROM audit.events WHERE entity_id = ${entityId} ORDER BY seq`;

const tree = () => listCategories({}, editor);
const nodeOf = (nodes: readonly CategoryNode[], id: string) => {
  const node = nodes.find((c) => c.id === id);
  if (!node) throw new Error(`category ${id} not in the tree`);
  return node;
};
const childrenOf = (nodes: readonly CategoryNode[], parentId: string | null) =>
  nodes.filter((c) => c.parentId === parentId).map((c) => c.id);

describe("catalog.category.create", () => {
  it("creates roots and children at the end of their siblings, and audits identifiers", async () => {
    const root = await category();
    const a = await category(root);
    const b = await category(root);
    const nodes = await tree();
    expect(childrenOf(nodes, root)).toEqual([a, b]);
    expect(nodeOf(nodes, a)).toMatchObject({ depth: 2, index: 0, siblingCount: 2, childCount: 0 });
    expect(nodeOf(nodes, root)).toMatchObject({ depth: 1, childCount: 2, productCount: 0 });
    // reading order: a parent comes right before its children
    const order = nodes.map((c) => c.id);
    expect(order.indexOf(a)).toBe(order.indexOf(root) + 1);
    expect(await auditFor(a)).toEqual([
      {
        action: "catalog.category.created",
        data: { categoryId: a, slug: expect.any(String), parentId: root },
      },
    ]);
  });

  it("needs Dutch and French names and a clean slug; a taken slug is refused", async () => {
    const base = { parentId: null, slug: slug(), nameNl: "Pijn", nameFr: "Douleur" };
    expect(await codeOf(createCategory({ ...base, nameFr: " " }, editor))).toBe(
      "kernel.validation_failed",
    );
    expect(await codeOf(createCategory({ ...base, slug: "Pain & Fever" }, editor))).toBe(
      "kernel.validation_failed",
    );
    await createCategory(base, editor);
    expect(await codeOf(createCategory({ ...base, nameNl: "Anders" }, editor))).toBe(
      "catalog.category_slug_taken",
    );
  });

  it("refuses an unknown parent and a tree deeper than the limit", async () => {
    expect(await codeOf(category(randomUUID()))).toBe("catalog.category_not_found");
    let parent: string | null = null;
    for (let depth = 1; depth <= MAX_CATEGORY_DEPTH; depth++) parent = await category(parent);
    expect(await codeOf(category(parent))).toBe("catalog.category_too_deep");
  });
});

describe("catalog.category.update", () => {
  it("renames a category and its slug, and audits it", async () => {
    const id = await category();
    const newSlug = slug("renamed");
    await updateCategory(
      {
        categoryId: id,
        expectedVersion: await cv(id),
        slug: newSlug,
        nameNl: "Huid",
        nameFr: "Peau",
        nameEn: "Skin",
      },
      editor,
    );
    expect(nodeOf(await tree(), id)).toMatchObject({
      slug: newSlug,
      nameNl: "Huid",
      nameFr: "Peau",
      nameDe: null,
      nameEn: "Skin",
    });
    expect((await auditFor(id)).at(-1)).toEqual({
      action: "catalog.category.updated",
      data: { categoryId: id, slug: newSlug, version: 2 },
    });
  });

  it("refuses another category's slug and an unknown category", async () => {
    const a = await category();
    const b = await category();
    const [aNode] = (await tree()).filter((c) => c.id === a);
    const names = { nameNl: "X", nameFr: "X" };
    expect(
      await codeOf(
        updateCategory(
          { categoryId: b, expectedVersion: await cv(b), slug: aNode?.slug ?? "", ...names },
          editor,
        ),
      ),
    ).toBe("catalog.category_slug_taken");
    expect(
      await codeOf(
        updateCategory(
          { categoryId: randomUUID(), expectedVersion: 1, slug: slug(), ...names },
          editor,
        ),
      ),
    ).toBe("catalog.category_not_found");
  });

  it("a rename racing a create for the same slug: one wins, the other gets slug_taken", async () => {
    for (let round = 0; round < 5; round++) {
      const existing = await category();
      const wanted = slug("race");
      const names = { nameNl: "X", nameFr: "X" };
      const results = await Promise.all([
        codeOf(
          updateCategory(
            { categoryId: existing, expectedVersion: await cv(existing), slug: wanted, ...names },
            editor,
          ),
        ),
        codeOf(createCategory({ parentId: null, slug: wanted, ...names }, editor)),
      ]);
      expect(results.sort()).toEqual(["catalog.category_slug_taken", "ok"]);
    }
  });
});

describe("catalog.category.move", () => {
  it("reorders siblings and renumbers them", async () => {
    const root = await category();
    const [a, b, c] = [await category(root), await category(root), await category(root)];
    await moveCategory(
      { categoryId: c, expectedVersion: await cv(c), parentId: root, position: 0 },
      editor,
    );
    expect(childrenOf(await tree(), root)).toEqual([c, a, b]);
    await moveCategory(
      { categoryId: c, expectedVersion: await cv(c), parentId: root, position: 99 },
      editor,
    );
    expect(childrenOf(await tree(), root)).toEqual([a, b, c]);
    expect((await auditFor(c)).at(-1)).toEqual({
      action: "catalog.category.moved",
      data: { categoryId: c, fromParentId: root, toParentId: root, position: 2, version: 3 },
    });
  });

  it("refuses a move to where it already is, and audits nothing", async () => {
    const root = await category();
    const a = await category(root);
    const before = (await auditFor(a)).length;
    expect(
      await codeOf(
        moveCategory(
          { categoryId: a, expectedVersion: await cv(a), parentId: root, position: 0 },
          editor,
        ),
      ),
    ).toBe("catalog.category_unchanged");
    expect(await auditFor(a)).toHaveLength(before);
  });

  it("moves a subtree under another parent and to the root", async () => {
    const left = await category();
    const right = await category();
    const branch = await category(left);
    const leaf = await category(branch);
    await moveCategory(
      { categoryId: branch, expectedVersion: await cv(branch), parentId: right, position: 0 },
      editor,
    );
    let nodes = await tree();
    expect(childrenOf(nodes, right)).toEqual([branch]);
    expect(childrenOf(nodes, left)).toEqual([]);
    expect(nodeOf(nodes, leaf).depth).toBe(3);
    await moveCategory(
      { categoryId: branch, expectedVersion: await cv(branch), parentId: null, position: 0 },
      editor,
    );
    nodes = await tree();
    expect(nodeOf(nodes, branch)).toMatchObject({ parentId: null, depth: 1, index: 0 });
  });

  it("refuses a cycle: under itself or under one of its descendants", async () => {
    const top = await category();
    const mid = await category(top);
    const low = await category(mid);
    expect(
      await codeOf(
        moveCategory(
          { categoryId: top, expectedVersion: await cv(top), parentId: top, position: 0 },
          editor,
        ),
      ),
    ).toBe("catalog.category_cycle");
    expect(
      await codeOf(
        moveCategory(
          { categoryId: top, expectedVersion: await cv(top), parentId: low, position: 0 },
          editor,
        ),
      ),
    ).toBe("catalog.category_cycle");
    expect(nodeOf(await tree(), top).parentId).toBeNull();
  });

  it("refuses a move that makes the tree too deep", async () => {
    let deep: string | null = null;
    for (let depth = 1; depth < MAX_CATEGORY_DEPTH; depth++) deep = await category(deep);
    const two = await category();
    await category(two); // `two` spans two levels
    expect(
      await codeOf(
        moveCategory(
          { categoryId: two, expectedVersion: await cv(two), parentId: deep, position: 0 },
          editor,
        ),
      ),
    ).toBe("catalog.category_too_deep");
  });

  it("lists siblings in the same order the moves count positions in (sort order, then id)", async () => {
    const root = await category();
    const first = await category(root);
    const second = await category(root);
    // A tie on sort_order (not reachable through the commands) must not fall back to names.
    await iso.sql`UPDATE catalog.categories SET sort_order = 0, name_nl = CASE id
      WHEN ${first} THEN 'Z' ELSE 'A' END WHERE parent_id = ${root}`;
    expect(childrenOf(await tree(), root)).toEqual([first, second]);
    await moveCategory(
      { categoryId: first, expectedVersion: await cv(first), parentId: root, position: 1 },
      editor,
    );
    expect(childrenOf(await tree(), root)).toEqual([second, first]);
  });

  it("two moves racing into a cycle: one wins, the other is refused", async () => {
    const x = await category();
    const y = await category();
    const results = await Promise.all([
      codeOf(
        moveCategory(
          { categoryId: x, expectedVersion: await cv(x), parentId: y, position: 0 },
          editor,
        ),
      ),
      codeOf(
        moveCategory(
          { categoryId: y, expectedVersion: await cv(y), parentId: x, position: 0 },
          editor,
        ),
      ),
    ]);
    expect(results.sort()).toEqual(["catalog.category_cycle", "ok"]);
  });
});

describe("catalog.category.delete", () => {
  it("deletes an empty category and audits it", async () => {
    const id = await category();
    await deleteCategory({ categoryId: id }, editor);
    expect((await tree()).some((c) => c.id === id)).toBe(false);
    expect((await auditFor(id)).at(-1)?.action).toBe("catalog.category.deleted");
  });

  it("is refused while it has sub-categories or products", async () => {
    const parent = await category();
    const child = await category(parent);
    expect(await codeOf(deleteCategory({ categoryId: parent }, editor))).toBe(
      "catalog.category_has_children",
    );
    const productId = await product();
    await setProductCategories({ productId, categoryIds: [child] }, editor);
    expect(await codeOf(deleteCategory({ categoryId: child }, editor))).toBe(
      "catalog.category_in_use",
    );
    await setProductCategories({ productId, categoryIds: [] }, editor);
    await deleteCategory({ categoryId: child }, editor);
    await deleteCategory({ categoryId: parent }, editor);
  });
});

describe("catalog.product.set_categories", () => {
  it("sets the categories as a whole set and audits the counts", async () => {
    const [a, b, c] = [await category(), await category(), await category()];
    const productId = await product();
    await setProductCategories({ productId, categoryIds: [a, b] }, editor);
    expect([...(await getProduct({ productId }, editor)).categoryIds].sort()).toEqual(
      [a, b].sort(),
    );
    await setProductCategories({ productId, categoryIds: [b, c] }, editor);
    expect([...(await getProduct({ productId }, editor)).categoryIds].sort()).toEqual(
      [b, c].sort(),
    );
    expect(nodeOf(await tree(), b).productCount).toBe(1);
    expect((await auditFor(productId)).at(-1)).toEqual({
      action: "catalog.product.categories_set",
      data: { productId, added: 1, removed: 1, total: 2 },
    });
    await setProductCategories({ productId, categoryIds: [] }, editor);
    expect((await getProduct({ productId }, editor)).categoryIds).toEqual([]);
  });

  it("refuses an unknown category, duplicates and an unknown product", async () => {
    const a = await category();
    const productId = await product();
    expect(
      await codeOf(setProductCategories({ productId, categoryIds: [a, randomUUID()] }, editor)),
    ).toBe("catalog.category_not_found");
    expect(await codeOf(setProductCategories({ productId, categoryIds: [a, a] }, editor))).toBe(
      "kernel.validation_failed",
    );
    expect(
      await codeOf(setProductCategories({ productId: randomUUID(), categoryIds: [a] }, editor)),
    ).toBe("catalog.product_not_found");
    expect((await getProduct({ productId }, editor)).categoryIds).toEqual([]);
  });
});

describe("permissions", () => {
  it("lets a pharmacist read the tree but not change it", async () => {
    const id = await category();
    expect((await listCategories({}, pharmacist)).some((c) => c.id === id)).toBe(true);
    expect(
      await codeOf(
        createCategory({ parentId: null, slug: slug(), nameNl: "X", nameFr: "X" }, pharmacist),
      ),
    ).toBe("kernel.forbidden");
    expect(
      await codeOf(
        moveCategory(
          { categoryId: id, expectedVersion: await cv(id), parentId: null, position: 0 },
          pharmacist,
        ),
      ),
    ).toBe("kernel.forbidden");
    expect(await codeOf(deleteCategory({ categoryId: id }, pharmacist))).toBe("kernel.forbidden");
  });

  it("refuses a customer and a staff member without 2-step login", async () => {
    const customer: Actor = {
      type: "user",
      id: randomUUID(),
      roles: ["customer"],
      kind: "customer",
    };
    expect(await codeOf(listCategories({}, customer))).toBe("kernel.forbidden");
    expect(
      await codeOf(
        createCategory(
          { parentId: null, slug: slug(), nameNl: "X", nameFr: "X" },
          { ...editor, mfaVerified: false },
        ),
      ),
    ).toBe("kernel.mfa_required");
  });
});
