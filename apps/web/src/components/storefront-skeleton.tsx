import { Container, Skeleton } from "@igs/ui";

/** Fixed keys for the placeholder cards: nothing in a skeleton has an identity of its own. */
const CARDS = ["a", "b", "c", "d", "e", "f"] as const;

interface Props {
  /** "Loading…" in the shopper's language, said once to assistive technology. */
  readonly label: string;
  /** A product list (home, category, search) or a single product page. */
  readonly variant: "listing" | "product";
}

function ListingBody() {
  return (
    <>
      <Skeleton className="h-9 w-2/3 max-w-md" />
      <Skeleton className="mt-3 h-5 w-40" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((key) => (
          <div
            key={key}
            className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4"
          >
            <Skeleton className="aspect-[4/3] w-full" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <div className="flex items-center justify-between gap-2 pt-2">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-6 w-24" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function ProductBody() {
  return (
    <>
      <Skeleton className="h-4 w-1/2 max-w-sm" />
      <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,16rem)_1fr]">
        <Skeleton className="aspect-[4/3] w-full" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-11 w-56" />
        </div>
      </div>
      <Skeleton className="mt-8 h-6 w-40" />
      <Skeleton className="mt-2 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-5/6" />
    </>
  );
}

/**
 * What the storefront shows while a page loads (igs-pharma#104): the frame's header, search row and
 * category column, and the page body, as grey blocks of the real sizes (same grid, same 4:3 image
 * box), so nothing moves when the content arrives. It reads no data, so it shows at once. The
 * blocks are hidden from screen readers; one status region says "Loading…" in words. No script and
 * no inline style (CSP, D-031); tokens only.
 */
export function StorefrontSkeleton({ label, variant }: Props) {
  return (
    <div data-testid="storefront-skeleton" className="flex min-h-screen flex-col">
      <div className="border-b border-[var(--color-border)]">
        <Container className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
          <Skeleton className="h-11 w-36" />
          <Skeleton className="h-6 w-64 max-w-full" />
        </Container>
        <Container className="pb-3">
          <Skeleton className="h-11 w-full md:max-w-md" />
        </Container>
      </div>
      <div className="flex-1">
        <Container className="grid gap-6 py-6 md:grid-cols-[14rem_1fr] md:gap-8 md:py-8">
          <div>
            <Skeleton className="h-11 w-full md:hidden" />
            <div className="hidden flex-col gap-3 md:flex">
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-5 w-32" />
            </div>
          </div>
          <main id="main" className="min-w-0">
            <div role="status" className="sr-only">{label}</div>
            {variant === "product" ? <ProductBody /> : <ListingBody />}
          </main>
        </Container>
      </div>
    </div>
  );
}
