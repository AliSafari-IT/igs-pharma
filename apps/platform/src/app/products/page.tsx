import { isDomainError } from "@igs/kernel";
import { type ProductPage, listProducts } from "@igs/module-catalog";
import { currentPrices } from "@igs/module-pricing";
import { Alert, Badge, Button, Container, Input, Label, Link, Stack } from "@igs/ui";

import { STATUS_BADGE, STATUS_LABELS, catalogErrorMessage } from "../../components/catalog-labels";
import { PageHeader } from "../../components/page-header";
import { formatEuros } from "../../components/price-labels";
import { requireStaffActor } from "../../server/actor";
import { ensureKernelConfigured } from "../../server/kernel";

export const metadata = { title: "Products · IGS-Pharma Platform" };

const PAGE_SIZE = 25;

interface Props {
  readonly searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The back-office product list (igs-pharma#50): search by CNK or name, newest change first. */
export default async function ProductsPage({ searchParams }: Props) {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const params = await searchParams;
  const q = (first(params.q) ?? "").trim().slice(0, 100);
  const page = Math.max(1, Math.min(10_000, Number.parseInt(first(params.page) ?? "1", 10) || 1));

  let result: ProductPage | null = null;
  let error: string | null = null;
  try {
    result = await listProducts({ q, page, pageSize: PAGE_SIZE }, actor);
  } catch (e) {
    if (!isDomainError(e)) throw e;
    error = e.code;
  }
  // the Price column needs pricing.price.read; without it the list has no Price column
  let priceOf: ReadonlyMap<string, number> | null = null;
  if (result) {
    try {
      const ids = result.items.map((item) => item.id);
      const rows = ids.length > 0 ? await currentPrices({ productIds: ids }, actor) : [];
      priceOf = new Map(rows.map((row) => [row.productId, row.amountCents]));
    } catch (e) {
      if (!isDomainError(e)) throw e;
    }
  }
  const pages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  const pageHref = (n: number) =>
    `/products?${new URLSearchParams({ ...(q ? { q } : {}), page: String(n) })}`;

  return (
    <Container asChild size="lg">
      <main className="py-10">
        <Stack gap={6}>
          <PageHeader
            title="Products"
            description="The catalogue: every product and its status."
            action={
              result ? (
                <Button asChild>
                  <a href="/products/new">New product</a>
                </Button>
              ) : null
            }
          />

          {error ? (
            <Alert variant="error" title="You can't see the catalogue">
              {catalogErrorMessage(error)}
            </Alert>
          ) : null}

          {result ? (
            <>
              <search>
                <form method="get" action="/products" className="flex flex-wrap items-end gap-3">
                  <div className="flex min-w-64 flex-1 flex-col gap-1.5">
                    <Label htmlFor="product-search">Search by CNK or name</Label>
                    <Input
                      id="product-search"
                      name="q"
                      type="search"
                      defaultValue={q}
                      maxLength={100}
                    />
                  </div>
                  <Button type="submit" variant="secondary">
                    Search
                  </Button>
                </form>
              </search>

              {result.items.length === 0 ? (
                <p className="text-[var(--color-text-subtle)]">
                  {q ? `No products match “${q}”.` : "No products yet."}
                </p>
              ) : (
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">
                    Products, page {result.page} of {pages}
                  </caption>
                  <thead>
                    <tr className="border-b border-[var(--color-border-strong)]">
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        CNK
                      </th>
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        Name (Dutch)
                      </th>
                      {priceOf ? (
                        <th scope="col" className="py-2 pr-4 text-right font-semibold">
                          Price
                        </th>
                      ) : null}
                      <th scope="col" className="py-2 font-semibold">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((item) => (
                      <tr key={item.id} className="border-b border-[var(--color-border)]">
                        <td className="py-2 pr-4">
                          <Link href={`/products/${item.id}`}>
                            <code>{item.cnk}</code>
                          </Link>
                        </td>
                        <td className="py-2 pr-4">
                          {item.nameNl ?? (
                            <span className="text-[var(--color-text-subtle)]">
                              No Dutch name yet
                            </span>
                          )}
                        </td>
                        {priceOf ? (
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {priceOf.has(item.id) ? (
                              formatEuros(priceOf.get(item.id) ?? 0)
                            ) : (
                              <span className="sr-only">No price</span>
                            )}
                          </td>
                        ) : null}
                        <td className="py-2">
                          <Badge variant={STATUS_BADGE[item.status]}>
                            {STATUS_LABELS[item.status]}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <nav aria-label="Pages" className="flex items-center gap-4">
                {result.page > 1 ? (
                  <Link href={pageHref(result.page - 1)}>Previous page</Link>
                ) : null}
                <span className="text-sm text-[var(--color-text-subtle)]">
                  Page {result.page} of {pages} · {result.total} product
                  {result.total === 1 ? "" : "s"}
                </span>
                {result.page < pages ? (
                  <Link href={pageHref(result.page + 1)}>Next page</Link>
                ) : null}
              </nav>
            </>
          ) : null}
        </Stack>
      </main>
    </Container>
  );
}
