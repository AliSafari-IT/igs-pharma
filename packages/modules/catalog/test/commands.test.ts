// Catalog commands and queries (igs-pharma#50) against real Postgres, with the RBAC catalogue
// loaded from the database and the real audit port, so permissions and audit shapes are exercised.
import { randomUUID } from "node:crypto";

import { type IsolatedDatabase, createIsolatedDatabase } from "@igs/db/testing";
import { type Actor, isDomainError } from "@igs/kernel";
import { type KernelTestHandles, configureKernelForTests } from "@igs/kernel/testing";
import { createAuditPort, registerAuditAction } from "@igs/module-audit";
import { loadRbacCatalogue } from "@igs/module-identity";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createBrand,
  createProduct,
  getProduct,
  listBrands,
  listProducts,
  registerAuditActions,
  setProductStatus,
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

let nextCnk = 9_900_100;
const cnk = () => String(nextCnk++);

const nl = { locale: "nl", name: "Demo Hoestsiroop" } as const;
const fr = { locale: "fr", name: "Démo Sirop contre la toux" } as const;

const product = (overrides: Record<string, unknown> = {}) => ({
  cnk: cnk(),
  productType: "otc_medicine",
  legalStatus: "otc",
  vatClass: "BE_6",
  content: [nl, fr],
  ...overrides,
});

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

describe("catalog.product.create", () => {
  it("creates a draft with its content, stamps the approval and audits identifiers only", async () => {
    const input = product({
      content: [{ ...nl, shortDescription: "  ", warnings: "Niet voor kinderen" }, fr],
    });
    const { productId } = await createProduct(input, editor);

    const view = await getProduct({ productId }, editor);
    expect(view).toMatchObject({ cnk: input.cnk, status: "draft", vatClass: "BE_6", ageMin: null });
    expect(view.content.map((c) => c.locale)).toEqual(["fr", "nl"]);
    const dutch = view.content.find((c) => c.locale === "nl");
    expect(dutch).toMatchObject({
      shortDescription: null,
      warnings: "Niet voor kinderen",
      source: "manual",
      approvedBy: editor.type === "user" ? editor.id : null,
    });
    expect(dutch?.approvedAt).toBeInstanceOf(Date);

    const audit = await auditFor(productId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "catalog.product.created",
      data: { productId, cnk: input.cnk },
    });
  });

  it.each(["123456", "12345678", "12a4567", ""])(
    "rejects CNK %j with catalog.cnk_invalid",
    async (bad) => {
      expect(await codeOf(createProduct(product({ cnk: bad }), editor))).toBe(
        "catalog.cnk_invalid",
      );
    },
  );

  it("rejects a CNK in use with catalog.cnk_taken", async () => {
    const taken = cnk();
    await createProduct(product({ cnk: taken }), editor);
    expect(await codeOf(createProduct(product({ cnk: taken }), editor))).toBe("catalog.cnk_taken");
  });

  it("rejects an unknown brand", async () => {
    expect(await codeOf(createProduct(product({ brandId: randomUUID() }), editor))).toBe(
      "catalog.brand_not_found",
    );
  });

  it("rejects the same locale twice", async () => {
    expect(await codeOf(createProduct(product({ content: [nl, nl] }), editor))).toBe(
      "kernel.validation_failed",
    );
  });
});

describe("catalog.product.set_status", () => {
  it("activates only with Dutch and French content", async () => {
    const { productId } = await createProduct(product({ content: [nl] }), editor);
    expect(await codeOf(setProductStatus({ productId, status: "active" }, editor))).toBe(
      "catalog.content_missing",
    );

    await updateProduct({ productId, ...product({ content: [nl, fr] }) }, editor);
    await expect(setProductStatus({ productId, status: "active" }, editor)).resolves.toEqual({
      productId,
      status: "active",
    });
    expect((await getProduct({ productId }, editor)).status).toBe("active");
    const audit = await auditFor(productId);
    expect(audit.map((a) => a.action)).toEqual([
      "catalog.product.created",
      "catalog.product.updated",
      "catalog.product.status_changed",
    ]);
    expect(audit[2]?.data).toEqual({ productId, from: "draft", to: "active" });
  });

  it("archives, and refuses a no-op change and an unknown product", async () => {
    const { productId } = await createProduct(product(), editor);
    expect(await codeOf(setProductStatus({ productId, status: "draft" }, editor))).toBe(
      "catalog.status_unchanged",
    );
    await setProductStatus({ productId, status: "archived" }, editor);
    expect(
      await codeOf(setProductStatus({ productId: randomUUID(), status: "active" }, editor)),
    ).toBe("catalog.product_not_found");
  });
});

describe("catalog.product.update", () => {
  it("replaces the content set and the core fields", async () => {
    const { productId } = await createProduct(
      product({ content: [nl, fr, { locale: "en", name: "Demo" }] }),
      editor,
    );
    const next = product({ vatClass: "BE_21", ageMin: 12, coldChain: true, content: [nl, fr] });
    await updateProduct({ productId, ...next }, editor);
    const view = await getProduct({ productId }, editor);
    expect(view).toMatchObject({ cnk: next.cnk, vatClass: "BE_21", ageMin: 12, coldChain: true });
    expect(view.content.map((c) => c.locale)).toEqual(["fr", "nl"]);
  });

  it("keeps an active product's Dutch and French content", async () => {
    const { productId } = await createProduct(product(), editor);
    await setProductStatus({ productId, status: "active" }, editor);
    expect(await codeOf(updateProduct({ productId, ...product({ content: [nl] }) }, editor))).toBe(
      "catalog.content_missing",
    );
  });

  it("refuses another product's CNK and an unknown product", async () => {
    const first = product();
    await createProduct(first, editor);
    const { productId } = await createProduct(product(), editor);
    expect(await codeOf(updateProduct({ productId, ...product({ cnk: first.cnk }) }, editor))).toBe(
      "catalog.cnk_taken",
    );
    expect(await codeOf(updateProduct({ productId: randomUUID(), ...product() }, editor))).toBe(
      "catalog.product_not_found",
    );
  });
});

describe("catalog.brand.create", () => {
  it("creates a brand with a unique slug, audited", async () => {
    const slug = `demo-${randomUUID().slice(0, 8)}`;
    const { brandId } = await createBrand({ name: "Demo Pharma", slug }, editor);
    expect(await codeOf(createBrand({ name: "Other", slug }, editor))).toBe(
      "catalog.brand_slug_taken",
    );
    expect((await listBrands({}, editor)).map((b) => b.id)).toContain(brandId);
    expect((await auditFor(brandId))[0]).toMatchObject({
      action: "catalog.brand.created",
      data: { brandId, slug },
    });
    const { productId } = await createProduct(product({ brandId }), editor);
    expect((await getProduct({ productId }, editor)).brandId).toBe(brandId);
  });
});

describe("catalog.brand.list", () => {
  it("finds brands by slug past the 1,000 brands the full list stops at", async () => {
    const tag = randomUUID().slice(0, 8);
    // 1,000 names that sort before "Zz…", so the full list never reaches the brand below
    await iso.sql`
      INSERT INTO catalog.brands (id, name, slug)
      SELECT gen_random_uuid(), ${`Aa ${tag} `} || n, ${`aa-${tag}-`} || n
      FROM generate_series(1, 1000) AS n`;
    const slug = `zz-${tag}`;
    const { brandId } = await createBrand({ name: `Zz ${tag}`, slug }, editor);
    expect((await listBrands({}, editor)).map((b) => b.id)).not.toContain(brandId);
    expect(await listBrands({ slugs: [slug, `missing-${tag}`] }, editor)).toEqual([
      { id: brandId, name: `Zz ${tag}`, slug },
    ]);
    expect(await codeOf(listBrands({ slugs: [] }, editor))).toBe("kernel.validation_failed");
  });
});

describe("catalog.product.list", () => {
  it("searches by CNK prefix or by name in any language, paged", async () => {
    const tag = randomUUID().slice(0, 8);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { productId } = await createProduct(
        product({
          content: [
            { locale: "nl", name: `Zoek ${tag} ${i}` },
            { locale: "fr", name: `Cherche ${i}` },
          ],
        }),
        editor,
      );
      ids.push(productId);
    }
    const page1 = await listProducts({ q: tag.toUpperCase(), pageSize: 2 }, editor);
    expect(page1.total).toBe(3);
    expect(page1.items).toHaveLength(2);
    const page2 = await listProducts({ q: tag, pageSize: 2, page: 2 }, editor);
    expect([...page1.items, ...page2.items].map((p) => p.id).sort()).toEqual([...ids].sort());
    expect(page1.items[0]?.nameNl).toMatch(/^Zoek /);

    const byCnk = await getProduct({ productId: ids[0] as string }, editor);
    const found = await listProducts({ q: byCnk.cnk }, editor);
    expect(found.items.map((p) => p.id)).toEqual([byCnk.id]);
    // LIKE wildcards are literal
    expect((await listProducts({ q: "%" }, editor)).total).toBe(0);
  });

  it("matches one CNK exactly with cnk, never a name that contains it", async () => {
    const target = await createProduct(product(), editor);
    const { cnk: exact } = await getProduct({ productId: target.productId }, editor);
    await createProduct(product({ content: [{ locale: "nl", name: `Demo ${exact}` }] }), editor);
    expect((await listProducts({ q: exact }, editor)).total).toBe(2);
    const found = await listProducts({ cnk: exact }, editor);
    expect(found.items.map((p) => p.id)).toEqual([target.productId]);
    expect(await codeOf(listProducts({ cnk: "123" }, editor))).toBe("kernel.validation_failed");
  });
});

describe("permissions", () => {
  it("lets the owner and the content editor manage, pharmacists and assistants only read", async () => {
    const { productId } = await createProduct(product(), owner);
    for (const reader of [
      staff("pharmacist"),
      staff("pharmacy_assistant"),
      staff("pharmacist_titular"),
    ]) {
      await expect(getProduct({ productId }, reader)).resolves.toMatchObject({ id: productId });
      expect(await codeOf(createProduct(product(), reader))).toBe("kernel.forbidden");
      expect(await codeOf(setProductStatus({ productId, status: "archived" }, reader))).toBe(
        "kernel.forbidden",
      );
    }
  });

  it("refuses customers, customer service and staff without a second factor", async () => {
    const customer: Actor = {
      type: "user",
      id: randomUUID(),
      roles: ["customer"],
      kind: "customer",
    };
    expect(await codeOf(listProducts({}, customer))).toBe("kernel.forbidden");
    expect(await codeOf(listProducts({}, staff("customer_service")))).toBe("kernel.forbidden");
    const noMfa: Actor = { ...owner, mfaVerified: false } as Actor;
    expect(await codeOf(createProduct(product(), noMfa))).toBe("kernel.mfa_required");
  });

  it("lets the seed CLI's system role read and write products, and nothing else", async () => {
    const seed: Actor = { type: "system", id: "seed-catalog", roles: ["system_seed"] };
    const { productId } = await createProduct(product(), seed);
    const view = await getProduct({ productId }, editor);
    expect(view.content[0]?.approvedBy).toBeNull();
    await expect(listProducts({}, seed)).resolves.toMatchObject({ page: 1 });
    expect(await codeOf(createProduct(product(), { ...seed, roles: ["system_auth"] }))).toBe(
      "kernel.forbidden",
    );
  });
});
