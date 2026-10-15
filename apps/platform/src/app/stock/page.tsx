import { isDomainError } from "@igs/kernel";
import { type StockPage, listStock } from "@igs/module-inventory";
import { Alert, Badge, Button, Container, EmptyState, Input, Label, Link, Stack } from "@igs/ui";

import { PageHeader } from "../../components/page-header";
import { StockImport } from "../../components/stock-import";
import { formatMoment, stockErrorMessage } from "../../components/stock-labels";
import { requireStaffActor } from "../../server/actor";
import { ensureKernelConfigured } from "../../server/kernel";

export const metadata = { title: "Stock · IGS-Pharma Platform" };

const PAGE_SIZE = 25;

interface Props {
  readonly searchParams: Promise<{
    q?: string | string[];
    page?: string | string[];
    imported?: string | string[];
  }>;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The back-office stock list (igs-pharma#53): on-hand per product, by CNK, and the CSV upload. */
export default async function StockListPage({ searchParams }: Props) {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const params = await searchParams;
  const q = (first(params.q) ?? "").trim().slice(0, 100);
  const page = Math.max(1, Math.min(10_000, Number.parseInt(first(params.page) ?? "1", 10) || 1));
  const importedText = first(params.imported);
  const imported = importedText && /^[0-9]+$/.test(importedText) ? Number(importedText) : null;

  let result: StockPage | null = null;
  let error: string | null = null;
  try {
    result = await listStock({ q, page, pageSize: PAGE_SIZE }, actor);
  } catch (e) {
    if (!isDomainError(e)) throw e;
    error = e.code;
  }
  const pages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  const pageHref = (n: number) =>
    `/stock?${new URLSearchParams({ ...(q ? { q } : {}), page: String(n) })}`;

  return (
    <Container asChild size="lg">
      <main className="py-10">
        <Stack gap={6}>
          <PageHeader
            title="Stock"
            description="How many of each product the pharmacy has on hand. Open a product to adjust its count, or import a whole stock count."
          />

          {error ? (
            <Alert variant="error" title="You can't see the stock">
              {stockErrorMessage(error)}
            </Alert>
          ) : null}

          {imported !== null ? (
            <Alert variant="success" title="Stock imported">
              {imported === 0
                ? "The counts already matched: nothing changed."
                : `${imported} product${imported === 1 ? "" : "s"} changed.`}
            </Alert>
          ) : null}

          {result ? (
            <>
              <search>
                <form method="get" action="/stock" className="flex flex-wrap items-end gap-3">
                  <div className="flex min-w-64 flex-1 flex-col gap-1.5">
                    <Label htmlFor="stock-search">Search by CNK or name</Label>
                    <Input
                      id="stock-search"
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
                <EmptyState
                  title={q ? `No products match “${q}”` : "No products in the catalogue yet"}
                  data-testid="stock-empty"
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <caption className="sr-only">
                      Stock, page {result.page} of {pages}
                    </caption>
                    <thead>
                      <tr className="border-b border-[var(--color-border-strong)]">
                        <th scope="col" className="py-2 pr-4 font-semibold">
                          CNK
                        </th>
                        <th scope="col" className="py-2 pr-4 font-semibold">
                          Name (Dutch)
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right font-semibold tabular-nums">
                          On hand
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right font-semibold tabular-nums">
                          Reserved
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right font-semibold tabular-nums">
                          Available
                        </th>
                        <th scope="col" className="py-2 font-semibold">
                          Last movement
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.items.map((item) => (
                        <tr key={item.productId} className="border-b border-[var(--color-border)]">
                          <td className="py-2 pr-4">
                            <Link href={`/stock/${item.productId}`}>
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
                          <td className="py-2 pr-4 text-right tabular-nums">{item.onHand}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{item.reserved}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {item.available}
                            {item.short > 0 ? (
                              <>
                                {" "}
                                <Badge variant="amber">Short by {item.short}</Badge>
                              </>
                            ) : null}
                          </td>
                          <td className="py-2">
                            {item.lastMovementAt ? (
                              formatMoment(item.lastMovementAt)
                            ) : (
                              <span className="text-[var(--color-text-subtle)]">Never</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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

              <StockImport />
            </>
          ) : null}
        </Stack>
      </main>
    </Container>
  );
}
