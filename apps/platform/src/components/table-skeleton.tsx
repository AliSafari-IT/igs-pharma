import { Skeleton } from "@igs/ui";

interface Props {
  readonly columns: number;
  readonly rows?: number;
}

/** Match the list's mobile cards and desktop rows; announce loading once. */
export function TableSkeleton({ columns, rows = 8 }: Props) {
  const fields = Array.from({ length: columns }, (_, index) => `field-${index}`);
  const items = Array.from({ length: rows }, (_, index) => `row-${index}`);
  return (
    <div data-testid="table-skeleton" className="flex flex-col gap-3">
      <output className="sr-only">Loading…</output>
      <div aria-hidden="true" className="flex flex-col gap-4 sm:gap-0">
        <div className="hidden gap-4 border-b border-[var(--color-border-strong)] py-2.5 sm:flex">
          {fields.map((field) => (
            <Skeleton key={field} className="h-5 flex-1" />
          ))}
        </div>
        {items.map((row) => (
          <div
            key={row}
            data-testid="loading-row"
            className="flex flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3 sm:flex-row sm:gap-4 sm:rounded-none sm:border-x-0 sm:border-t-0 sm:p-0 sm:py-2.5"
          >
            {fields.map((field) => (
              <div
                key={field}
                className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 py-2 sm:block sm:flex-1 sm:py-0"
              >
                <Skeleton className="h-5 w-16 max-w-full sm:hidden" />
                <Skeleton className="h-5 w-full" />
              </div>
            ))}
          </div>
        ))}
      </div>
      <Skeleton className="h-5 w-48 max-w-full" />
    </div>
  );
}
