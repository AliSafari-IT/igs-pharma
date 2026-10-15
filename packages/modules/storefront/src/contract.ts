import { CONTENT_LOCALES, VAT_CLASSES } from "@igs/module-catalog";
import { z } from "zod";

/**
 * The storefront query contract (igs-pharma#103, consumed by the browse UI of #104). One source of
 * truth: the zod schemas below are the contract, the TypeScript types are inferred from them, and the
 * fixtures in `fixtures.ts` are validated against them. Changes go through the #103 thread.
 */

export const LOCALES = CONTENT_LOCALES;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;

/** How much of a product is on the shelf, never how many. `low` is 1..threshold (default 3). */
export const AVAILABILITY_STATUSES = ["available", "low", "out"] as const;
export const statusSchema = z.enum(AVAILABILITY_STATUSES);
export type AvailabilityStatus = z.infer<typeof statusSchema>;

export const LIST_SORTS = ["relevance", "latest", "name", "price_asc", "price_desc"] as const;
export type ListSort = (typeof LIST_SORTS)[number];

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;
export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 48;
export const MAX_PAGE = 10_000;

/** Postgres refuses a NUL byte in text (22021), so it is refused here, before any query runs. */
const hasNul = (value: string | undefined): boolean => value?.includes("\u0000") ?? false;

/** `q`: trimmed; omitted or empty means no text filter; one character and a NUL byte are refused. */
const queryInput = z
  .string()
  .trim()
  .max(MAX_QUERY_LENGTH)
  .optional()
  .transform((value) => (value === "" ? undefined : value))
  .refine((value) => !hasNul(value), { message: "invalid_character" })
  .refine((value) => value === undefined || [...value].length >= MIN_QUERY_LENGTH, {
    message: "too_short",
  });

/** `storefront.products.list` input. */
export const listInputSchema = z.object({
  locale: localeSchema,
  q: queryInput,
  /** That category or any descendant. */
  categorySlug: z
    .string()
    .min(1)
    .max(100)
    .refine((value) => !hasNul(value), { message: "invalid_character" })
    .optional(),
  /** Omitted: all; `in_stock`: available or low. */
  availability: z.enum(["in_stock"]).optional(),
  /** Default: `relevance` when `q` is given, otherwise `name`. */
  sort: z.enum(LIST_SORTS).optional(),
  page: z.coerce.number().int().min(1).max(MAX_PAGE).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListInput = z.input<typeof listInputSchema>;
export type ParsedListInput = z.output<typeof listInputSchema>;

/** The sort a request gets when it names none. */
export const defaultSort = (q: string | undefined): ListSort => (q ? "relevance" : "name");

export const priceSchema = z.object({
  /** Euro cents including VAT. */
  amountCents: z.number().int().positive(),
  vatClass: z.enum(VAT_CLASSES),
  /** Basis points: 600 = 6 %. */
  vatRateBp: z.number().int().min(0),
});
export type StorefrontPriceView = z.infer<typeof priceSchema>;

export const categoryRefSchema = z.object({ slug: z.string(), name: z.string() });
export type CategoryRef = z.infer<typeof categoryRefSchema>;

export const itemSchema = z.object({
  id: z.uuid(),
  cnk: z.string().regex(/^[0-9]{7}$/),
  name: z.string(),
  brandName: z.string().nullable(),
  shortDescription: z.string().nullable(),
  /** The language of `name` and the texts: the shopper's, or Dutch when that row is missing or unapproved. */
  contentLocale: localeSchema,
  price: priceSchema,
  status: statusSchema,
  /** Show the leaflet / ask-your-pharmacist notice. */
  isMedicine: z.boolean(),
  /**
   * The top-level category the product sits under: the root of its breadcrumb path (deepest
   * category, the first in tree order among equals), so a card and its product page agree. `null`
   * when the product is in no category. Picks the illustration; never a filter.
   */
  topCategory: categoryRefSchema.nullable(),
});
export type StorefrontListItem = z.infer<typeof itemSchema>;

export const listOutputSchema = z.object({
  items: z.array(itemSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  pageCount: z.number().int().min(0),
  category: categoryRefSchema.nullable(),
  /** The normalised query. */
  q: z.string().nullable(),
});
export type StorefrontListing = z.infer<typeof listOutputSchema>;

/** `storefront.product.get` input. */
export const getInputSchema = z.object({
  cnk: z.string().regex(/^[0-9]{7}$/),
  locale: localeSchema,
});

export const productSchema = itemSchema.extend({
  description: z.string().nullable(),
  warnings: z.string().nullable(),
  /** Root to deepest category, empty when the product is in none. */
  breadcrumb: z.array(categoryRefSchema),
  categories: z.array(categoryRefSchema),
});
export type StorefrontProductView = z.infer<typeof productSchema>;

/** `storefront.categories` input and output (the shape the removed `catalog.storefront.categories` had). */
export const categoriesInputSchema = z.object({ locale: localeSchema });
export const categoryNodeSchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  slug: z.string(),
  name: z.string(),
  depth: z.number().int().min(1),
  /** Visible, priced products in this category and everything below it. */
  productCount: z.number().int().min(1),
});
export type StorefrontCategoryNode = z.infer<typeof categoryNodeSchema>;

/** Why a product is not on the storefront (back-office, `storefront.product.visibility`). */
export const VISIBILITY_REASON_CODES = [
  "draft",
  "archived",
  "prescription_only",
  "no_price",
  "text_not_approved",
] as const;
export const visibilityReasonSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("draft") }),
  z.object({ code: z.literal("archived") }),
  z.object({ code: z.literal("prescription_only") }),
  z.object({ code: z.literal("no_price") }),
  z.object({
    code: z.literal("text_not_approved"),
    /** The required locales whose text no pharmacist approved. */
    locales: z.array(z.enum(["nl", "fr"])).min(1),
  }),
]);
export type VisibilityReason = z.infer<typeof visibilityReasonSchema>;

export const visibilityInputSchema = z.object({ productId: z.uuid() });
export const visibilityOutputSchema = z.object({
  visible: z.boolean(),
  reasons: z.array(visibilityReasonSchema),
});
export type ProductVisibility = z.infer<typeof visibilityOutputSchema>;
