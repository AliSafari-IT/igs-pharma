import { type Candidate, composeListing } from "./compose";
import {
  type AvailabilityStatus,
  type CategoryRef,
  type ListInput,
  type StorefrontListing,
  type StorefrontPriceView,
  type StorefrontProductView,
  listInputSchema,
} from "./contract";

/**
 * Fixture data that follows the storefront contract (igs-pharma#103), for the browse UI's tests and
 * stories. Deterministic: the same input gives the same answer, through the SAME composition code the
 * real queries use. Never imported by production code.
 */

const uuid = (n: number) => `0192f000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const day = (n: number) => new Date(Date.UTC(2026, 9, n, 12, 0, 0));

interface FixtureProduct extends Candidate {
  readonly price: StorefrontPriceView;
  readonly status: AvailabilityStatus;
  readonly description: string | null;
  readonly warnings: string | null;
  /** Category slugs the product is in. */
  readonly categorySlugs: readonly string[];
}

const six = (amountCents: number): StorefrontPriceView => ({
  amountCents,
  vatClass: "BE_6",
  vatRateBp: 600,
});
const twentyOne = (amountCents: number): StorefrontPriceView => ({
  amountCents,
  vatClass: "BE_21",
  vatRateBp: 2100,
});

const product = (
  n: number,
  values: Omit<FixtureProduct, "id" | "cnk" | "rank" | "contentLocale"> & {
    contentLocale?: FixtureProduct["contentLocale"];
  },
): FixtureProduct => ({
  id: uuid(n),
  cnk: String(9_900_000 + n),
  rank: 0,
  contentLocale: "nl",
  ...values,
});

/** A small, varied catalogue: medicines and care products, three stock states, two VAT classes. */
export const FIXTURE_PRODUCTS: readonly FixtureProduct[] = [
  product(1, {
    name: "Paracetamol 500 mg 30 tabletten",
    brandName: "Febrisan",
    shortDescription: "Tegen pijn en koorts",
    description: "Paracetamol 500 mg, 30 tabletten.",
    warnings: "Niet meer dan 8 tabletten per dag.",
    isMedicine: true,
    createdAt: day(1),
    price: six(449),
    status: "available",
    categorySlugs: ["pijn-koorts"],
  }),
  product(2, {
    name: "Ibuprofen 400 mg 20 tabletten",
    brandName: "Febrisan",
    shortDescription: "Tegen pijn en ontsteking",
    description: "Ibuprofen 400 mg, 20 tabletten.",
    warnings: "Niet gebruiken bij maagzweer.",
    isMedicine: true,
    createdAt: day(2),
    price: six(699),
    status: "low",
    categorySlugs: ["pijn-koorts"],
  }),
  product(3, {
    name: "Zinkzalf 50 g",
    brandName: "Dermacare",
    shortDescription: "Beschermende zalf voor de huid",
    description: null,
    warnings: null,
    isMedicine: false,
    createdAt: day(3),
    price: twentyOne(850),
    status: "available",
    categorySlugs: ["huidverzorging"],
  }),
  product(4, {
    name: "Hydraterende handcrème 75 ml",
    brandName: "Dermacare",
    shortDescription: "Voor droge handen",
    description: "Handcrème met glycerine.",
    warnings: null,
    isMedicine: false,
    createdAt: day(4),
    price: twentyOne(595),
    status: "out",
    categorySlugs: ["huidverzorging"],
  }),
  product(5, {
    name: "Neusspray zeewater 20 ml",
    brandName: null,
    shortDescription: "Reinigt en bevochtigt de neus",
    description: null,
    warnings: "Niet langer dan 7 dagen gebruiken.",
    isMedicine: false,
    createdAt: day(5),
    price: six(525),
    status: "available",
    categorySlugs: ["verkoudheid"],
  }),
  product(6, {
    name: "Hoestsiroop honing 150 ml",
    brandName: "Vitalis",
    shortDescription: "Bij droge hoest",
    description: "Hoestsiroop op basis van honing en tijm.",
    warnings: "Niet geschikt voor kinderen onder 1 jaar.",
    isMedicine: true,
    createdAt: day(6),
    price: six(1015),
    status: "low",
    categorySlugs: ["verkoudheid"],
  }),
  product(7, {
    name: "Pleisters assortiment 40 stuks",
    brandName: "Vitalis",
    shortDescription: null,
    description: null,
    warnings: null,
    isMedicine: false,
    createdAt: day(7),
    price: twentyOne(399),
    status: "available",
    categorySlugs: ["eerste-hulp"],
  }),
  product(8, {
    name: "Thermometer digitaal",
    brandName: "Febrisan",
    shortDescription: "Meting in 10 seconden",
    description: null,
    warnings: null,
    isMedicine: false,
    createdAt: day(8),
    price: twentyOne(1290),
    status: "available",
    categorySlugs: ["eerste-hulp", "pijn-koorts"],
  }),
];

/** Slugs of the fixture categories, parent before child (`pijn-koorts` is under `gezondheid`). */
export const FIXTURE_CATEGORIES: readonly (CategoryRef & { readonly parentSlug: string | null })[] =
  [
    { slug: "gezondheid", name: "Gezondheid", parentSlug: null },
    { slug: "pijn-koorts", name: "Pijn en koorts", parentSlug: "gezondheid" },
    { slug: "verkoudheid", name: "Verkoudheid", parentSlug: "gezondheid" },
    { slug: "huidverzorging", name: "Huidverzorging", parentSlug: null },
    { slug: "eerste-hulp", name: "Eerste hulp", parentSlug: null },
  ];

/** A category and everything below it. */
function subtree(slug: string): ReadonlySet<string> {
  const slugs = new Set<string>([slug]);
  for (const category of FIXTURE_CATEGORIES) {
    if (category.parentSlug && slugs.has(category.parentSlug)) slugs.add(category.slug);
  }
  return slugs;
}

const fold = (text: string) => text.toLowerCase();

/** The fixture version of `storefront.products.list`: same contract, same composition. */
export async function fixtureListProducts(input: ListInput): Promise<StorefrontListing> {
  const parsed = listInputSchema.parse(input);
  const scope = parsed.categorySlug ? subtree(parsed.categorySlug) : undefined;
  const category = parsed.categorySlug
    ? (FIXTURE_CATEGORIES.find((c) => c.slug === parsed.categorySlug) ?? null)
    : null;
  if (parsed.categorySlug && !category) throw new Error("catalog.category_not_found");
  const terms = parsed.q ? fold(parsed.q).split(/\s+/) : [];
  const candidates = FIXTURE_PRODUCTS.filter((p) => {
    if (scope && !p.categorySlugs.some((slug) => scope.has(slug))) return false;
    const haystack = fold(`${p.name} ${p.brandName ?? ""} ${p.shortDescription ?? ""}`);
    return terms.every((term) => haystack.includes(term) || p.cnk === parsed.q);
  }).map<Candidate>((p) => ({
    id: p.id,
    cnk: p.cnk,
    name: p.name,
    brandName: p.brandName,
    shortDescription: p.shortDescription,
    contentLocale: p.contentLocale,
    isMedicine: p.isMedicine,
    createdAt: p.createdAt,
    rank: !parsed.q ? 0 : p.cnk === parsed.q ? 0 : fold(p.name).startsWith(fold(parsed.q)) ? 1 : 2,
  }));
  return composeListing(parsed, {
    candidates,
    prices: new Map(FIXTURE_PRODUCTS.map((p) => [p.id, p.price])),
    loadStatuses: async (ids) =>
      new Map(
        FIXTURE_PRODUCTS.filter((p) => ids.includes(p.id)).map((p) => [p.id, p.status] as const),
      ),
    category: category ? { slug: category.slug, name: category.name } : null,
  });
}

/** The fixture version of `storefront.product.get`; `undefined` stands for `catalog.product_not_found`. */
export function fixtureGetProduct(cnk: string): StorefrontProductView | undefined {
  const found = FIXTURE_PRODUCTS.find((p) => p.cnk === cnk);
  if (!found) return undefined;
  const categories = FIXTURE_CATEGORIES.filter((c) => found.categorySlugs.includes(c.slug));
  const deepest = categories[0];
  const breadcrumb: CategoryRef[] = [];
  for (let at = deepest; at; at = FIXTURE_CATEGORIES.find((c) => c.slug === at?.parentSlug)) {
    breadcrumb.unshift({ slug: at.slug, name: at.name });
  }
  return {
    id: found.id,
    cnk: found.cnk,
    name: found.name,
    brandName: found.brandName,
    shortDescription: found.shortDescription,
    contentLocale: found.contentLocale,
    price: found.price,
    status: found.status,
    isMedicine: found.isMedicine,
    description: found.description,
    warnings: found.warnings,
    breadcrumb,
    categories: categories.map((c) => ({ slug: c.slug, name: c.name })),
  };
}
