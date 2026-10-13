// Catalogue edit correctness (igs-pharma#80) against real Postgres: the CNK race (D1), optimistic
// concurrency with a version (D2) and the CNK as a business key (D3).
import { randomUUID } from "node:crypto";

import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { type Actor, isDomainError } from "@igs/kernel";
import { type KernelTestHandles, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { loadRbacCatalogue } from "@igs/module-identity";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createCategory,
  createProduct,
  getProduct,
  listCategories,
  moveCategory,
  registerAuditActions,
  setProductStatus,
  updateCategory,
  updateProduct,
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

const editor: Actor = {
  type: "user",
  id: randomUUID(),
  roles: ["content_editor"],
  kind: "staff",
  mfaVerified: true,
};

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  return "ok";
};

let nextCnk = 9_500_100;
const newCnk = () => String(nextCnk++);

const nl = { locale: "nl", name: "Hoestsiroop" } as const;
const fr = { locale: "fr", name: "Sirop contre la toux" } as const;
const en = { locale: "en", name: "Cough syrup" } as const;

const fields = (overrides: Record<string, unknown> = {}) => ({
  cnk: newCnk(),
  productType: "otc_medicine",
  legalStatus: "otc",
  vatClass: "BE_6",
  content: [nl, fr],
  ...overrides,
});

const auditFor = (entityId: string) =>
  iso.sql<{ action: string; data: Record<string, unknown> }[]>`
    SELECT action, data FROM audit.events WHERE entity_id = ${entityId} ORDER BY seq`;

/** What an edit form would have loaded: the product as the back-office reads it. */
const load = (productId: string) => getProduct({ productId }, editor);

/** The form's save: every field of the loaded product, with the version it loaded. */
const asForm = (
  view: Awaited<ReturnType<typeof load>>,
  overrides: Record<string, unknown> = {},
) => ({
  productId: view.id,
  expectedVersion: view.version,
  cnk: view.cnk,
  productType: view.productType,
  legalStatus: view.legalStatus,
  vatClass: view.vatClass,
  requiresPharmacistReview: view.requiresPharmacistReview,
  ageMin: view.ageMin,
  coldChain: view.coldChain,
  brandId: view.brandId,
  content: view.content.map((c) => ({
    locale: c.locale,
    name: c.name,
    shortDescription: c.shortDescription,
    description: c.description,
    warnings: c.warnings,
  })),
  ...overrides,
});

describe("D1: a CNK race never returns a raw unique violation", () => {
  const ROUNDS = 25;

  it("update vs create on one CNK: exactly one wins, the other gets catalog.cnk_taken", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { productId } = await createProduct(fields(), editor);
      const target = newCnk();
      const view = await load(productId);
      const results = await Promise.all([
        codeOf(updateProduct(asForm(view, { cnk: target }), editor)),
        codeOf(createProduct(fields({ cnk: target }), editor)),
      ]);
      expect(results.sort(), `round ${round}`).toEqual(["catalog.cnk_taken", "ok"]);
      const [row] = await iso.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM catalog.products WHERE cnk = ${target}`;
      expect(row?.n).toBe(1);
    }
  });

  it("update vs update on one CNK: exactly one wins, the other gets catalog.cnk_taken", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const a = await load((await createProduct(fields(), editor)).productId);
      const b = await load((await createProduct(fields(), editor)).productId);
      const target = newCnk();
      const results = await Promise.all([
        codeOf(updateProduct(asForm(a, { cnk: target }), editor)),
        codeOf(updateProduct(asForm(b, { cnk: target }), editor)),
      ]);
      expect(results.sort(), `round ${round}`).toEqual(["catalog.cnk_taken", "ok"]);
    }
  });

  it("the unique index itself decides when the pre-check saw a free CNK (deterministic)", async () => {
    // another transaction has inserted the CNK but not committed: the "is it free?" SELECT cannot
    // see it, so the UPDATE blocks on the index and then loses with a unique violation
    const { productId } = await createProduct(fields(), editor);
    const view = await load(productId);
    const target = newCnk();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inserted: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    const holder = iso.sql.begin(async (tx) => {
      await tx`INSERT INTO catalog.products (id, cnk, product_type, legal_status, vat_class, status)
        VALUES (gen_random_uuid(), ${target}, 'otc_medicine', 'otc', 'BE_6', 'draft')`;
      inserted();
      await gate;
    });
    await ready;
    const loser = codeOf(updateProduct(asForm(view, { cnk: target }), editor));
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await holder;
    expect(await loser).toBe("catalog.cnk_taken");
    expect((await load(productId)).cnk).toBe(view.cnk); // untouched
  });
});

describe("D2: optimistic concurrency on products", () => {
  it("every write bumps the version by one and the audit records the new one", async () => {
    const { productId, version } = await createProduct(fields(), editor);
    expect(version).toBe(1);
    expect((await load(productId)).version).toBe(1);
    const updated = await updateProduct(asForm(await load(productId)), editor);
    expect(updated.version).toBe(2);
    const status = await setProductStatus({ productId, status: "active" }, editor);
    expect(status.version).toBe(3);
    expect((await load(productId)).version).toBe(3);
    const versions = (await auditFor(productId)).map((a) => a.data["version"]);
    expect(versions).toEqual([1, 2, 3]);
  });

  it("the stale form, literally: a save from an old form is refused and loses nothing", async () => {
    // both editors open the product; it has Dutch and French
    const { productId } = await createProduct(fields({ ageMin: 6 }), editor);
    const formA = await load(productId);
    const formB = await load(productId);

    // editor B adds an English translation and changes a core field, and saves first
    await updateProduct(
      asForm(formB, { ageMin: 12, content: [...asForm(formB).content, en] }),
      editor,
    );

    // editor A's form still shows Dutch + French only and the old age; it is refused
    const stale = updateProduct(
      asForm(formA, { requiresPharmacistReview: true, content: [{ ...nl, name: "A's edit" }] }),
      editor,
    );
    expect(await codeOf(stale)).toBe("catalog.stale_version");

    // nothing of editor B's work is gone, and nothing of A's was written
    const after = await load(productId);
    expect(after.content.map((c) => c.locale).sort()).toEqual(["en", "fr", "nl"]);
    expect(after.content.find((c) => c.locale === "nl")?.name).toBe(nl.name);
    expect(after.ageMin).toBe(12);
    expect(after.requiresPharmacistReview).toBe(false);
    expect(after.version).toBe(2);

    // A reloads and applies the change again: it works
    await updateProduct(asForm(await load(productId), { requiresPharmacistReview: true }), editor);
    const final = await load(productId);
    expect(final.requiresPharmacistReview).toBe(true);
    expect(final.content.map((c) => c.locale).sort()).toEqual(["en", "fr", "nl"]);
    expect(final.version).toBe(3);
  });

  it("the refusal carries the two versions and changes no audit", async () => {
    const { productId } = await createProduct(fields(), editor);
    const view = await load(productId);
    await updateProduct(asForm(view), editor);
    const before = (await auditFor(productId)).length;
    let details: unknown;
    try {
      await updateProduct(asForm(view), editor);
    } catch (error) {
      if (isDomainError(error)) details = error.details;
    }
    expect(details).toEqual({ expected: 1, current: 2 });
    expect((await auditFor(productId)).length).toBe(before);
  });

  it("a status change makes an open edit form stale (it must be reloaded)", async () => {
    const { productId } = await createProduct(fields(), editor);
    const form = await load(productId);
    await setProductStatus({ productId, status: "active" }, editor);
    expect(await codeOf(updateProduct(asForm(form), editor))).toBe("catalog.stale_version");
  });

  it("a missing version is a validation error, not a silent overwrite", async () => {
    const { productId } = await createProduct(fields(), editor);
    const { expectedVersion: _omitted, ...withoutVersion } = asForm(await load(productId));
    expect(await codeOf(updateProduct(withoutVersion as never, editor))).toBe(
      "kernel.validation_failed",
    );
  });

  it("two editors saving at the same moment: one wins, the other is stale", async () => {
    for (let round = 0; round < 10; round++) {
      const { productId } = await createProduct(fields(), editor);
      const view = await load(productId);
      const results = await Promise.all([
        codeOf(updateProduct(asForm(view, { coldChain: true }), editor)),
        codeOf(updateProduct(asForm(view, { ageMin: 18 }), editor)),
      ]);
      expect(results.sort(), `round ${round}`).toEqual(["catalog.stale_version", "ok"]);
    }
  });
});

describe("D3: the CNK is a business key", () => {
  it("is refused on an active product, before anything is written", async () => {
    const { productId } = await createProduct(fields(), editor);
    await setProductStatus({ productId, status: "active" }, editor);
    const view = await load(productId);
    expect(await codeOf(updateProduct(asForm(view, { cnk: newCnk() }), editor))).toBe(
      "catalog.cnk_locked",
    );
    const after = await load(productId);
    expect([after.cnk, after.version]).toEqual([view.cnk, view.version]);
    // the same CNK, other fields: an active product can still be edited
    await updateProduct(asForm(view, { ageMin: 16 }), editor);
    expect((await load(productId)).ageMin).toBe(16);
  });

  it("on a draft or archived product the change is audited with both CNKs", async () => {
    const { productId } = await createProduct(fields(), editor);
    const first = await load(productId);
    const second = newCnk();
    await updateProduct(asForm(first, { cnk: second }), editor);
    await setProductStatus({ productId, status: "archived" }, editor);
    const third = newCnk();
    await updateProduct(asForm(await load(productId), { cnk: third }), editor);
    const changes = (await auditFor(productId)).filter(
      (a) => a.action === "catalog.product.cnk_changed",
    );
    expect(changes.map((a) => a.data)).toEqual([
      { productId, fromCnk: first.cnk, toCnk: second },
      { productId, fromCnk: second, toCnk: third },
    ]);
    // an edit that keeps the CNK records no cnk_changed
    await updateProduct(asForm(await load(productId), { ageMin: 3 }), editor);
    expect(
      (await auditFor(productId)).filter((a) => a.action === "catalog.product.cnk_changed"),
    ).toHaveLength(2);
  });

  it("the documented correction of an active product: archive, correct the CNK, activate again", async () => {
    const { productId } = await createProduct(fields(), editor);
    await setProductStatus({ productId, status: "active" }, editor);
    const corrected = newCnk();
    await setProductStatus({ productId, status: "archived" }, editor);
    await updateProduct(asForm(await load(productId), { cnk: corrected }), editor);
    await setProductStatus({ productId, status: "active" }, editor);
    const view = await load(productId);
    expect([view.cnk, view.status, view.id]).toEqual([corrected, "active", productId]);
  });

  it("a CNK in the audit shape must be seven digits (the same pattern as the domain)", async () => {
    const { productId } = await createProduct(fields(), editor);
    const rows = (await auditFor(productId)).filter((a) => a.action === "catalog.product.created");
    expect(rows[0]?.data["cnk"]).toMatch(/^[0-9]{7}$/);
  });
});

describe("D2: optimistic concurrency on categories", () => {
  let n = 0;
  const category = async (parentId: string | null = null) =>
    createCategory(
      {
        parentId,
        slug: `ver-${++n}-${randomUUID().slice(0, 4)}`,
        nameNl: `Cat ${n}`,
        nameFr: `Cat ${n}`,
      },
      editor,
    );
  const node = async (id: string) => (await listCategories({}, editor)).find((c) => c.id === id);
  const names = { nameNl: "X", nameFr: "X" };

  it("a rename bumps the version, and a stale rename is refused and changes nothing", async () => {
    const { categoryId, version } = await category();
    expect(version).toBe(1);
    const loaded = await node(categoryId);
    expect(loaded?.version).toBe(1);
    const renamed = await updateCategory(
      {
        categoryId,
        expectedVersion: 1,
        slug: loaded?.slug ?? "",
        nameNl: "Eerste",
        nameFr: "Premier",
      },
      editor,
    );
    expect(renamed.version).toBe(2);
    expect(
      await codeOf(
        updateCategory(
          {
            categoryId,
            expectedVersion: 1,
            slug: loaded?.slug ?? "",
            nameNl: "Tweede",
            nameFr: "Second",
          },
          editor,
        ),
      ),
    ).toBe("catalog.stale_version");
    expect((await node(categoryId))?.nameNl).toBe("Eerste");
    const audit = (await auditFor(categoryId)).filter(
      (a) => a.action === "catalog.category.updated",
    );
    expect(audit.map((a) => a.data["version"])).toEqual([2]);
  });

  it("moving up or down is relative to the siblings as they are NOW, not as the page rendered", async () => {
    const parent = (await category()).categoryId;
    const a = (await category(parent)).categoryId;
    const b = (await category(parent)).categoryId;
    const c = (await category(parent)).categoryId;
    // the page rendered [a, b, c]; "move c up" is what the button says
    const pageVersionOfC = (await node(c))?.version ?? 0;
    // meanwhile someone inserts d and moves it to the front
    const d = (await category(parent)).categoryId;
    await moveCategory(
      {
        categoryId: d,
        expectedVersion: (await node(d))?.version ?? 0,
        parentId: parent,
        position: 0,
      },
      editor,
    );
    // c's own version is unchanged by d's insert at the front?  d's move rewrote c's sort order: stale
    expect(
      await codeOf(
        moveCategory({ categoryId: c, expectedVersion: pageVersionOfC, direction: "up" }, editor),
      ),
    ).toBe("catalog.stale_version");
    // after a reload the same button lands exactly one place up from where c is now
    const reloaded = await node(c);
    const siblingsBefore = (await listCategories({}, editor))
      .filter((x) => x.parentId === parent)
      .map((x) => x.id);
    await moveCategory(
      { categoryId: c, expectedVersion: reloaded?.version ?? 0, direction: "up" },
      editor,
    );
    const siblingsAfter = (await listCategories({}, editor))
      .filter((x) => x.parentId === parent)
      .map((x) => x.id);
    const from = siblingsBefore.indexOf(c);
    expect(siblingsAfter.indexOf(c)).toBe(from - 1);
    expect(siblingsAfter).toHaveLength(4);
    expect(new Set(siblingsAfter)).toEqual(new Set([a, b, c, d]));
  });

  it("move down, the edges, and the absolute form with its version", async () => {
    const parent = (await category()).categoryId;
    const [a, b] = [(await category(parent)).categoryId, (await category(parent)).categoryId];
    const v = async (id: string) => (await node(id))?.version ?? 0;
    // the first cannot go up, the last cannot go down
    expect(
      await codeOf(
        moveCategory({ categoryId: a, expectedVersion: await v(a), direction: "up" }, editor),
      ),
    ).toBe("catalog.category_unchanged");
    expect(
      await codeOf(
        moveCategory({ categoryId: b, expectedVersion: await v(b), direction: "down" }, editor),
      ),
    ).toBe("catalog.category_unchanged");
    const moved = await moveCategory(
      { categoryId: a, expectedVersion: await v(a), direction: "down" },
      editor,
    );
    expect(moved.position).toBe(1);
    const order = (await listCategories({}, editor))
      .filter((x) => x.parentId === parent)
      .map((x) => x.id);
    expect(order).toEqual([b, a]);
    // the absolute form needs the version too
    expect(
      await codeOf(
        moveCategory({ categoryId: a, expectedVersion: 1, parentId: null, position: 0 }, editor),
      ),
    ).toBe("catalog.stale_version");
    const { version } = await moveCategory(
      { categoryId: a, expectedVersion: await v(a), parentId: null, position: 0 },
      editor,
    );
    expect(version).toBe(await v(a));
  });

  it("a reorder bumps the version of every row it writes, siblings included", async () => {
    const parent = (await category()).categoryId;
    const [a, b, c] = [
      (await category(parent)).categoryId,
      (await category(parent)).categoryId,
      (await category(parent)).categoryId,
    ];
    const before = Object.fromEntries(
      await Promise.all([a, b, c].map(async (id) => [id, (await node(id))?.version ?? 0] as const)),
    );
    await moveCategory({ categoryId: c, expectedVersion: before[c] ?? 0, direction: "up" }, editor);
    // c and b swapped places: both were written, a was not
    expect((await node(c))?.version).toBe((before[c] ?? 0) + 1);
    expect((await node(b))?.version).toBe((before[b] ?? 0) + 1);
    expect((await node(a))?.version).toBe(before[a]);
    const moved = (await auditFor(c)).filter((x) => x.action === "catalog.category.moved");
    expect(moved.at(-1)?.data["version"]).toBe((before[c] ?? 0) + 1);
  });

  it("an unknown category is not found, whatever version is sent", async () => {
    expect(
      await codeOf(
        updateCategory(
          { categoryId: randomUUID(), expectedVersion: 1, slug: "nope", ...names },
          editor,
        ),
      ),
    ).toBe("catalog.category_not_found");
    expect(
      await codeOf(
        moveCategory({ categoryId: randomUUID(), expectedVersion: 1, direction: "up" }, editor),
      ),
    ).toBe("catalog.category_not_found");
  });
});
