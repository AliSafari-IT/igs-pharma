import {
  type AvailabilityStatus,
  type CategoryRef,
  type ListSort,
  type Locale,
  type ParsedListInput,
  type StorefrontListItem,
  type StorefrontListing,
  type StorefrontPriceView,
  defaultSort,
} from "./contract";

/**
 * Composition of one listing page from what the three modules return (igs-pharma#103): pure
 * functions, no I/O, so the same code serves the real queries and the fixtures. The candidate set
 * (every storefront-visible product matching the filters) is held in memory, sorted and paged here;
 * see the README for the ceiling and the trigger to move to a materialised read model.
 */

/** A storefront-visible product that matches the request's filters (catalog's answer). */
export interface Candidate {
  readonly id: string;
  readonly cnk: string;
  readonly name: string;
  readonly brandName: string | null;
  readonly shortDescription: string | null;
  readonly contentLocale: Locale;
  readonly isMedicine: boolean;
  readonly createdAt: Date;
  /** 0 exact CNK, 1 name starts with the query, 2 name contains it, 3 brand or description; 0 without a query. */
  readonly rank: number;
}

export interface ListingParts {
  readonly candidates: readonly Candidate[];
  /** Current prices; a product absent here has none and is not listed. */
  readonly prices: ReadonlyMap<string, StorefrontPriceView>;
  /** Availability of these products; one absent from the answer counts as `out`. */
  readonly loadStatuses: (
    ids: readonly string[],
  ) => Promise<ReadonlyMap<string, AvailabilityStatus>>;
  readonly category: CategoryRef | null;
}

const COLLATION_TAG: Record<Locale, string> = {
  nl: "nl-BE",
  fr: "fr-BE",
  de: "de-BE",
  en: "en-GB",
};

const compareText = (collator: Intl.Collator, a: string, b: string) => collator.compare(a, b);
const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The ordering of a sort: always ends on the unique id, so pages never repeat or skip a product. */
export function comparatorFor(
  sort: ListSort,
  locale: Locale,
  prices: ReadonlyMap<string, StorefrontPriceView>,
): (a: Candidate, b: Candidate) => number {
  const collator = new Intl.Collator(COLLATION_TAG[locale], { sensitivity: "base", numeric: true });
  const byName = (a: Candidate, b: Candidate) =>
    compareText(collator, a.name, b.name) || compareId(a.id, b.id);
  const amount = (c: Candidate) => prices.get(c.id)?.amountCents ?? Number.MAX_SAFE_INTEGER;
  switch (sort) {
    case "relevance":
      return (a, b) => a.rank - b.rank || byName(a, b);
    case "latest":
      return (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || compareId(b.id, a.id);
    case "price_asc":
      return (a, b) => amount(a) - amount(b) || byName(a, b);
    case "price_desc":
      return (a, b) => amount(b) - amount(a) || byName(a, b);
    default:
      return byName;
  }
}

/** One page of the listing for `input`, from the candidates, prices and availability. */
export async function composeListing(
  input: ParsedListInput,
  parts: ListingParts,
): Promise<StorefrontListing> {
  const sort = input.sort ?? defaultSort(input.q);
  // an unpriced product cannot be sold: it is not listed
  const priced = parts.candidates.filter((candidate) => parts.prices.has(candidate.id));

  let statuses: ReadonlyMap<string, AvailabilityStatus> | undefined;
  let pool = priced;
  if (input.availability === "in_stock") {
    statuses = await parts.loadStatuses(priced.map((c) => c.id));
    const loaded = statuses;
    pool = priced.filter((c) => {
      const status = loaded.get(c.id);
      return status === "available" || status === "low";
    });
  }
  const ordered = [...pool].sort(comparatorFor(sort, input.locale, parts.prices));
  const total = ordered.length;
  const pageCount = Math.ceil(total / input.pageSize);
  const start = (input.page - 1) * input.pageSize;
  const slice = ordered.slice(start, start + input.pageSize);

  const pageStatuses = statuses ?? (await parts.loadStatuses(slice.map((c) => c.id)));
  const items: StorefrontListItem[] = slice.map((candidate) => {
    const price = parts.prices.get(candidate.id);
    if (!price) throw new Error("storefront: a listed product has no price"); // filtered above
    return {
      id: candidate.id,
      cnk: candidate.cnk,
      name: candidate.name,
      brandName: candidate.brandName,
      shortDescription: candidate.shortDescription,
      contentLocale: candidate.contentLocale,
      price,
      status: pageStatuses.get(candidate.id) ?? "out",
      isMedicine: candidate.isMedicine,
    };
  });
  return {
    items,
    total,
    page: input.page,
    pageSize: input.pageSize,
    pageCount,
    category: parts.category,
    q: input.q ?? null,
  };
}

/** `available` above the threshold, `low` from 1 up to it, `out` at zero or below. Never a count. */
export function statusOf(onHand: number, lowStock: number): AvailabilityStatus {
  if (onHand <= 0) return "out";
  return onHand <= lowStock ? "low" : "available";
}
