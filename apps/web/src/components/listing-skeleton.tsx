import { Skeleton } from "@igs/ui";

interface Props {
  /** The localized "Loading…" (`common.loading`), said once for the whole list. */
  readonly label: string;
  /** How many card placeholders; the real page shows up to a page of products. */
  readonly cards?: number;
}

/**
 * What a product listing shows while it loads (igs-pharma#104, design-system §10.8): the count line,
 * the sort/filter row and the cards at their real sizes (the same 1/2/3-column grid and 4:3 image
 * box as `ProductGrid`), so nothing jumps when the products arrive. The blocks are hidden from
 * screen readers; the one `<output>` says "Loading…" in words. No script, no inline style.
 */
export function ListingSkeleton({ label, cards = 6 }: Props) {
  return (
    <div data-testid="listing-skeleton">
      <output className="sr-only">{label}</output>
      <Skeleton className="mt-1 h-6 w-32" />
      {/* as ListControls: a labelled select, the "in stock" box and the apply button */}
      <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-[44px] w-48" />
        </div>
        <Skeleton className="h-[44px] w-40" />
        <Skeleton className="h-[44px] w-28" />
      </div>
      <ul aria-hidden="true" className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: cards }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholders, never reordered
          <li key={index}>
            <div className="flex h-full flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
              <Skeleton className="aspect-[4/3] w-full" />
              <Skeleton className="h-7 w-3/4" />
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-5 w-full" />
              <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-6 w-20" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
