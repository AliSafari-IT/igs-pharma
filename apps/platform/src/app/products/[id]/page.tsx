import { isDomainError } from "@igs/kernel";
import {
  type BrandView,
  type CategoryNode,
  type ProductStatus,
  type ProductView,
  getProduct,
  listBrands,
  listCategories,
  missingForActivation,
} from "@igs/module-catalog";
import { Alert, Badge, Button, Container, Link, Stack } from "@igs/ui";
import { notFound } from "next/navigation";

import {
  LOCALE_LABELS,
  STATUS_BADGE,
  STATUS_LABELS,
  catalogErrorMessage,
  statusLabelFor,
} from "../../../components/catalog-labels";
import { ProductForm } from "../../../components/product-form";
import { requireStaffActor } from "../../../server/actor";
import { ensureKernelConfigured } from "../../../server/kernel";
import { changeStatus, saveProductCategories } from "../actions";

export const metadata = { title: "Product · IGS-Pharma Platform" };

/** Indent by depth, as fixed classes: the CSP refuses inline styles, and Tailwind needs literals. */
const INDENT: Record<number, string> = { 2: "pl-6", 3: "pl-12", 4: "pl-18" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What each status can move to, with the button text. */
const MOVES: Record<ProductStatus, readonly { to: ProductStatus; label: string }[]> = {
  draft: [
    { to: "active", label: "Make active" },
    { to: "archived", label: "Archive" },
  ],
  active: [
    { to: "draft", label: "Back to draft" },
    { to: "archived", label: "Archive" },
  ],
  archived: [{ to: "draft", label: "Restore as draft" }],
};

interface Props {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<{
    saved?: string;
    status?: string;
    error?: string;
    categories?: string;
    categoriesError?: string;
  }>;
}

/** Edit one product and change its status (igs-pharma#50). */
export default async function ProductPage({ params, searchParams }: Props) {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const { id } = await params;
  const flash = await searchParams;
  if (!UUID.test(id)) notFound();

  let product: ProductView | null = null;
  let brands: readonly BrandView[] = [];
  let categories: readonly CategoryNode[] = [];
  let error: string | null = null;
  try {
    [product, brands, categories] = await Promise.all([
      getProduct({ productId: id }, actor),
      listBrands({}, actor),
      listCategories({}, actor),
    ]);
  } catch (e) {
    if (!isDomainError(e)) throw e;
    if (e.code === "catalog.product_not_found") notFound();
    error = e.code;
  }

  if (!product) {
    return (
      <Container asChild size="md">
        <main className="py-10">
          <Alert variant="error" title="You can't see the catalogue">
            {catalogErrorMessage(error ?? undefined)}
          </Alert>
        </main>
      </Container>
    );
  }

  const missing = missingForActivation(product.content.map((c) => c.locale));
  const dutchName = product.content.find((c) => c.locale === "nl")?.name;
  const movedTo = statusLabelFor(flash.status);

  return (
    <Container asChild size="md">
      <main className="py-10">
        <Stack gap={6}>
          <Link href="/products">Back to products</Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-4xl font-medium text-[var(--color-primary)]">
              {dutchName ?? `Product ${product.cnk}`}
            </h1>
            <Badge variant={STATUS_BADGE[product.status]}>{STATUS_LABELS[product.status]}</Badge>
          </div>

          {flash.saved ? <Alert variant="success" title="Product saved" /> : null}
          {movedTo ? (
            <Alert variant="success" title={`Status changed to ${movedTo.toLowerCase()}`} />
          ) : null}
          {flash.error ? (
            <Alert variant="error" title="The status was not changed">
              {catalogErrorMessage(flash.error)}
            </Alert>
          ) : null}

          <section aria-labelledby="status-heading" className="flex flex-col gap-3">
            <h2 id="status-heading" className="font-display text-xl font-semibold">
              Status
            </h2>
            {product.status !== "active" && missing.length > 0 ? (
              <p className="text-sm text-[var(--color-text-subtle)]">
                To make it active, add a name in{" "}
                {missing.map((l) => LOCALE_LABELS[l]).join(" and ")}.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              {MOVES[product.status].map((move) => (
                <form key={move.to} action={changeStatus}>
                  <input type="hidden" name="productId" value={product.id} />
                  <input type="hidden" name="status" value={move.to} />
                  <Button
                    type="submit"
                    variant={move.to === "active" ? "primary" : "secondary"}
                    disabled={move.to === "active" && missing.length > 0}
                  >
                    {move.label}
                  </Button>
                </form>
              ))}
            </div>
          </section>

          <section aria-labelledby="categories-heading" className="flex flex-col gap-3">
            <h2 id="categories-heading" className="font-display text-xl font-semibold">
              Categories
            </h2>
            {flash.categories ? <Alert variant="success" title="Categories saved" /> : null}
            {flash.categoriesError ? (
              <Alert variant="error" title="The categories were not saved">
                {catalogErrorMessage(flash.categoriesError)}
              </Alert>
            ) : null}
            {categories.length === 0 ? (
              <p className="text-sm text-[var(--color-text-subtle)]">
                There are no categories yet. <Link href="/categories">Add them first</Link>.
              </p>
            ) : (
              <form action={saveProductCategories} className="flex flex-col gap-3">
                <input type="hidden" name="productId" value={product.id} />
                <fieldset className="flex flex-col gap-1">
                  <legend className="sr-only">Categories this product is in</legend>
                  {categories.map((category) => (
                    <label
                      key={category.id}
                      className={`flex min-h-[36px] items-center gap-2 ${INDENT[category.depth] ?? ""}`}
                    >
                      <input
                        type="checkbox"
                        name="categoryId"
                        value={category.id}
                        defaultChecked={product.categoryIds.includes(category.id)}
                        className="size-5 accent-[var(--color-primary)]"
                      />
                      {category.nameNl}
                    </label>
                  ))}
                </fieldset>
                <div>
                  <Button type="submit" variant="secondary">
                    Save categories
                  </Button>
                </div>
              </form>
            )}
          </section>

          <ProductForm key={product.updatedAt.toISOString()} product={product} brands={brands} />
        </Stack>
      </main>
    </Container>
  );
}
