import { notFound, query } from "@igs/kernel";
import {
  CategoryNotFound,
  getStorefrontProductDetail,
  productVisibilityFacts,
  searchStorefrontCandidates,
  storefrontCategoryIndex,
} from "@igs/module-catalog";
import { storefrontAvailability } from "@igs/module-inventory";
import { productsWithCurrentPrice, storefrontPriceCards } from "@igs/module-pricing";
import { PERMISSIONS } from "@igs/rbac";

import { composeListing } from "./compose";
import { currentLowStockThreshold } from "./config";
import {
  type ProductVisibility,
  type StorefrontCategoryNode,
  type StorefrontListing,
  type StorefrontPriceView,
  type StorefrontProductView,
  type VisibilityReason,
  categoriesInputSchema,
  getInputSchema,
  listInputSchema,
  visibilityInputSchema,
} from "./contract";

/**
 * The storefront read model (igs-pharma#103): the browse contract the shop builds on. Each query
 * composes the public, storefront-visible-only helpers of catalog, pricing and inventory inside ONE
 * kernel query, so the outer permission is the only check (see the README for the rules).
 */

const toPriceView = (price: {
  amountCents: number;
  vatClass: "BE_6" | "BE_21";
  vatRateBp: number;
}): StorefrontPriceView => ({
  amountCents: price.amountCents,
  vatClass: price.vatClass,
  vatRateBp: price.vatRateBp,
});

/**
 * One page of storefront products: text search, category subtree, availability filter, sort and
 * pagination. See `contract.ts` for the shapes and the behaviour the UI can rely on.
 */
export const listStorefrontProducts = query({
  name: "storefront.products.list",
  input: listInputSchema,
  permission: PERMISSIONS.catalog.storefrontRead,
  async handler({ input, ctx }): Promise<StorefrontListing> {
    let set: Awaited<ReturnType<typeof searchStorefrontCandidates>>;
    try {
      set = await searchStorefrontCandidates(ctx.tx, {
        locale: input.locale,
        q: input.q,
        categorySlug: input.categorySlug,
      });
    } catch (error) {
      if (error instanceof CategoryNotFound) throw notFound("catalog.category_not_found");
      throw error;
    }
    const cards = await storefrontPriceCards(
      ctx.tx,
      set.candidates.map((candidate) => candidate.id),
      ctx.now,
    );
    return composeListing(input, {
      candidates: set.candidates,
      prices: new Map([...cards].map(([id, card]) => [id, toPriceView(card)])),
      loadStatuses: (ids) => storefrontAvailability(ctx.tx, ids, currentLowStockThreshold()),
      category: set.category,
    });
  },
});

/** One product by CNK with its texts, price and availability; hidden is indistinguishable from unknown. */
export const getStorefrontProduct = query({
  name: "storefront.product.get",
  input: getInputSchema,
  permission: PERMISSIONS.catalog.storefrontRead,
  async handler({ input, ctx }): Promise<StorefrontProductView> {
    const detail = await getStorefrontProductDetail(ctx.tx, input.cnk, input.locale);
    if (!detail) throw notFound("catalog.product_not_found");
    const cards = await storefrontPriceCards(ctx.tx, [detail.id], ctx.now);
    const card = cards.get(detail.id);
    // a product without a price cannot be sold: it is not shown
    if (!card) throw notFound("catalog.product_not_found");
    const statuses = await storefrontAvailability(ctx.tx, [detail.id], currentLowStockThreshold());
    return {
      id: detail.id,
      cnk: detail.cnk,
      name: detail.name,
      brandName: detail.brandName,
      shortDescription: detail.shortDescription,
      contentLocale: detail.contentLocale,
      price: toPriceView(card),
      status: statuses.get(detail.id) ?? "out",
      isMedicine: detail.isMedicine,
      description: detail.description,
      warnings: detail.warnings,
      breadcrumb: [...detail.breadcrumb],
      categories: [...detail.categories],
    };
  },
});

/**
 * The category tree in reading order, only categories with at least one visible, PRICED product in
 * them or below (so the counts match the listing).
 */
export const listStorefrontCategories = query({
  name: "storefront.categories",
  input: categoriesInputSchema,
  permission: PERMISSIONS.catalog.storefrontRead,
  async handler({ input, ctx }): Promise<readonly StorefrontCategoryNode[]> {
    const index = await storefrontCategoryIndex(ctx.tx, input.locale);
    const everyProduct = [...new Set([...index.productsByCategory.values()].flat())];
    const priced = new Set((await storefrontPriceCards(ctx.tx, everyProduct, ctx.now)).keys());
    const direct = (categoryId: string) =>
      (index.productsByCategory.get(categoryId) ?? []).filter((id) => priced.has(id));

    const children = new Map<string | null, typeof index.categories>();
    for (const category of index.categories) {
      const list = children.get(category.parentId) ?? [];
      children.set(category.parentId, [...list, category]);
    }
    // distinct priced products in a category and below (a product in two of them counts once)
    const below = (categoryId: string, seen: Set<string> = new Set()): Set<string> => {
      for (const id of direct(categoryId)) seen.add(id);
      for (const child of children.get(categoryId) ?? []) below(child.id, seen);
      return seen;
    };
    const out: StorefrontCategoryNode[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const category of children.get(parentId) ?? []) {
        const productCount = below(category.id).size;
        if (productCount === 0) continue;
        out.push({
          id: category.id,
          parentId: category.parentId,
          slug: category.slug,
          name: category.name,
          depth,
          productCount,
        });
        walk(category.id, depth + 1);
      }
    };
    walk(null, 1);
    return out;
  },
});

/**
 * BACK-OFFICE: whether a product is on the storefront and, if not, why (draft, archived, prescription
 * only, a medicine whose Dutch or French text no pharmacist approved, no current price). For staff who
 * hold `catalog.products.read`; the storefront actor gets `kernel.forbidden`. `visible` is exactly "no
 * reasons", and a test keeps it equal to "the product appears in the shop's listing".
 */
export const productVisibility = query({
  name: "storefront.product.visibility",
  input: visibilityInputSchema,
  permission: PERMISSIONS.catalog.productsRead,
  async handler({ input, ctx }): Promise<ProductVisibility> {
    const facts = await productVisibilityFacts(ctx.tx, input.productId, ctx.can);
    if (!facts) throw notFound("catalog.product_not_found");
    const reasons: VisibilityReason[] = [];
    if (facts.status === "draft") reasons.push({ code: "draft" });
    if (facts.status === "archived") reasons.push({ code: "archived" });
    const prescriptionOnly = facts.legalStatus === "rx" || facts.productType === "rx_medicine";
    if (prescriptionOnly) reasons.push({ code: "prescription_only" });
    if (facts.isMedicine && !prescriptionOnly) {
      const locales = (["nl", "fr"] as const).filter((locale) => !facts.approved[locale]);
      if (locales.length > 0) reasons.push({ code: "text_not_approved", locales });
    }
    const priced = await productsWithCurrentPrice(ctx.tx, [facts.productId], ctx.now, ctx.can);
    if (!priced.has(facts.productId)) reasons.push({ code: "no_price" });
    return { visible: reasons.length === 0, reasons };
  },
});
