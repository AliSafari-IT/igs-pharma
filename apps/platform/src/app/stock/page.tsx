import type { ResolvedActor } from "@igs/auth";
import { isDomainError } from "@igs/kernel";
import { type StockPage, listStock } from "@igs/module-inventory";
import { PERMISSIONS, hasPermission } from "@igs/rbac";
import { Alert, Badge, Container, EmptyState, Link, Stack } from "@igs/ui";
import { Suspense } from "react";

import { ListPager } from "../../components/list-pager";
import { ListSearch } from "../../components/list-search";
import { PageHeader } from "../../components/page-header";
import { StockImport } from "../../components/stock-import";
import { formatMoment, stockErrorMessage } from "../../components/stock-labels";
import { TableSkeleton } from "../../components/table-skeleton";
import { type ListQuery, pageCount, parseListQuery } from "../../lib/list-query";
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

/**
 * The back-office stock list (igs-pharma#53): on-hand per product, by CNK, and the CSV upload.
 *
 * The sign-in check runs BEFORE anything streams (#142): the header, the import notice and the
 * search box show at once; only the table (and the upload below it) waits behind `<Suspense>`.
 */
export default async function StockListPage({ searchParams }: Props) {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const params = await searchParams;
  const query = parseListQuery(params);
  const importedText = first(params.imported);
  const imported = importedText && /^[0-9]+$/.test(importedText) ? Number(importedText) : null;
  const canRead = hasPermission(actor.roles, PERMISSIONS.inventory.stockRead);

  return (
    <Container asChild size="lg">
      <main className="py-10">
        <Stack gap={6}>
          <PageHeader
            title="Stock"
            description="How many of each product the pharmacy has on hand. Open a product to adjust its count, or import a whole stock count."
          />

          {imported !== null ? (
            <Alert variant="success" title="Stock imported">
              {imported === 0
                ? "The counts already matched: nothing changed."
                : `${imported} product${imported === 1 ? "" : "s"} changed.`}
            </Alert>
          ) : null}

          {canRead ? (
            <ListSearch
              action="/stock"
              id="stock-search"
              label="Search by CNK or name"
              q={query.q}
            />
          ) : null}
          {/* a new key per query, so a search or page change shows the placeholder again */}
          <Suspense key={`${query.q}|${query.page}`} fallback={<TableSkeleton columns={6} />}>
            <StockTable actor={actor} query={query} />
          </Suspense>
        </Stack>
      </main>
    </Container>
  );
}

async function StockTable({ actor, query }: { actor: ResolvedActor; query: ListQuery }) {
  const { q, page } = query;
  let result: StockPage | null = null;
  let error: string | null = null;
  try {
    result = await listStock({ q, page, pageSize: PAGE_SIZE }, actor);
  } catch (e) {
    if (!isDomainError(e)) throw e;
    error = e.code;
  }
  if (!result) {
    return (
      <Alert variant="error" title="You can't see the stock">
        {stockErrorMessage(error ?? "kernel.forbidden")}
      </Alert>
    );
  }
  const pages = pageCount(result.total, PAGE_SIZE);

  return (
    <>
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
                      <span className="text-[var(--color-text-subtle)]">No Dutch name yet</span>
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

      <ListPager
        path="/stock"
        q={q}
        page={result.page}
        pageSize={PAGE_SIZE}
        total={result.total}
        noun="product"
      />

      <StockImport />
    </>
  );
}
