import { CategoryArt } from "./category-icon";

/**
 * The picture slot of a product (igs-pharma#112, V2 items 3 and 4) until real images exist: a fixed
 * 4:3 box with its category's illustration, never a stock photo of pills. Decorative (`aria-hidden`):
 * the product's name carries the meaning. The fixed aspect ratio keeps the layout still once real
 * images arrive. Without a slug (list items carry no category yet) it shows the generic art.
 */
export function ProductIllustration({ slug }: { readonly slug?: string | undefined }) {
  return (
    <div
      aria-hidden="true"
      className="flex aspect-[4/3] w-full items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-primary-subtle)]"
    >
      <CategoryArt slug={slug} testId="product-illustration" className="h-1/2 w-auto" />
    </div>
  );
}
