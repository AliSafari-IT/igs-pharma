import { Container, Skeleton, Stack } from "@igs/ui";

import { PageHeader } from "./page-header";

/** Fixed keys for the placeholder rows: nothing in a skeleton has an identity of its own. */
const ROWS = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

interface Props {
  /** The page's own title: the heading shows at once, only the data waits. */
  readonly title: string;
  /** Whether the page has a search row above its table. */
  readonly search?: boolean;
}

/**
 * What a back-office list page shows while it loads (igs-pharma#104): the real page header, then
 * grey blocks where the description, the search row and the table rows will be, in the same
 * column and spacing, so the page does not jump when the data arrives. The blocks are hidden from
 * screen readers; one `<output>` (a status region) says "Loading…" in words. No script and no
 * inline style (CSP, D-031); tokens only.
 */
export function ListPageSkeleton({ title, search = false }: Props) {
  // PageHeader puts the description in a <p>, which may not hold a <div> (Skeleton): the same
  // look as an inline block
  const description = (
    <span
      aria-hidden="true"
      className="block h-5 w-full rounded-[var(--radius-md)] bg-[var(--color-surface-2)] motion-safe:animate-pulse"
    />
  );
  return (
    <Container asChild size="lg">
      <main className="py-10" data-testid="list-skeleton">
        <Stack gap={6}>
          <PageHeader title={title} description={description} />
          <output className="sr-only">{`Loading ${title.toLowerCase()}…`}</output>
          {search ? (
            <div className="flex flex-wrap items-end gap-3">
              <Skeleton className="h-11 min-w-64 flex-1" />
              <Skeleton className="h-11 w-24" />
            </div>
          ) : null}
          <div className="flex flex-col">
            <Skeleton className="mb-2 h-6 w-full" />
            {ROWS.map((key) => (
              <div key={key} className="border-b border-[var(--color-border)] py-2">
                <Skeleton className="h-6 w-full" />
              </div>
            ))}
          </div>
        </Stack>
      </main>
    </Container>
  );
}
