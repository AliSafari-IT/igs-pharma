import { Skeleton } from "@igs/ui";

interface Props {
  /** How many columns the real table has. */
  readonly columns: number;
  readonly rows?: number;
}

/**
 * What a back-office list shows while its rows load (igs-pharma#104, design-system §10.8): rows at the
 * real table's height and the count line, so nothing jumps when the data arrives. The blocks are
 * hidden from screen readers; one `<output>` says "Loading…". No script, no inline style.
 */
export function TableSkeleton({ columns, rows = 8 }: Props) {
  return (
    <div data-testid="table-skeleton" className="flex flex-col gap-3">
      <output className="sr-only">Loading…</output>
      <div className="flex flex-col">
        {Array.from({ length: rows + 1 }, (_, row) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder rows, never reordered
          <div key={row} className="flex gap-4 border-b border-[var(--color-border)] py-2.5">
            {Array.from({ length: columns }, (_, column) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder cells
              <Skeleton key={column} className={`h-5 ${column === 1 ? "flex-[3]" : "flex-1"}`} />
            ))}
          </div>
        ))}
      </div>
      <Skeleton className="h-5 w-48" />
    </div>
  );
}
