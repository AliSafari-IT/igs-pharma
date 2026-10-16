import { Skeleton } from "@igs/ui";

import { ProductCardsSkeleton } from "./listing-skeleton";

interface Props {
  /** The localized "Loading…" (`common.loading`), said once for the whole page part. */
  readonly label: string;
}

/** As many tiles as one row of `CategoryGrid` on a wide screen (two rows on a phone). */
const CATEGORY_TILES = 4;

/** As many cards as the home's "latest products" shows. */
const FEATURED_CARDS = 6;

/**
 * What the home page shows while its categories and latest products load (igs-pharma#104,
 * design-system §10.8): each section's heading bar, the category tiles at `CategoryGrid`'s
 * sizes (2/4 columns, at least 88px high) and the product cards at `ProductGrid`'s sizes, with the
 * same spacing as the real sections, so nothing jumps when they arrive. The blocks are hidden from
 * screen readers; the one `<output>` says "Loading…" in words. No script, no inline style.
 */
export function HomeSkeleton({ label }: Props) {
  return (
    <div data-testid="home-skeleton">
      <output className="sr-only">{label}</output>
      <div className="mt-8">
        {/* as the section's h2: text-2xl, one line */}
        <Skeleton className="mb-3 h-8 w-64" />
        <ul aria-hidden="true" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: CATEGORY_TILES }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholders, never reordered
            <li key={index}>
              <div className="flex h-full min-h-[88px] flex-col justify-between gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
                <Skeleton className="h-10 w-10 shrink-0" />
                <Skeleton className="h-7 w-3/4" />
                <Skeleton className="h-5 w-1/2" />
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-10">
        <Skeleton className="mb-3 h-8 w-56" />
        <ProductCardsSkeleton cards={FEATURED_CARDS} />
      </div>
    </div>
  );
}
