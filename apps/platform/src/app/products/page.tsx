import type { ResolvedActor } from "@igs/auth";
import { isDomainError } from "@igs/kernel";
import { type ProductPage, listProducts } from "@igs/module-catalog";
import { currentPrices } from "@igs/module-pricing";
import { PERMISSIONS, hasPermission } from "@igs/rbac";
import { Alert, Badge, Button, Container, EmptyState, Link, Stack } from "@igs/ui";
import { Suspense } from "react";

import { STATUS_BADGE, STATUS_LABELS, catalogErrorMessage } from "../../components/catalog-labels";
import { ListPager } from "../../components/list-pager";
import { ListSearch } from "../../components/list-search";
import { PageHeader } from "../../components/page-header";
import { formatEuros } from "../../components/price-labels";
import {
  ResponsiveTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/responsive-table";
import { TableSkeleton } from "../../components/table-skeleton";
import { type ListQuery, pageCount, parseListQuery } from "../../lib/list-query";
import { requireStaffActor } from "../../server/actor";
import { ensureKernelConfigured } from "../../server/kernel";

export const metadata = { title: "Products · IGS-Pharma Platform" };

const PAGE_SIZE = 25;

interface Props {
  readonly searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}

/**
 * The back-office product list (igs-pharma#50): search by CNK or name, newest change first.
 *
 * The sign-in check runs BEFORE anything streams (#142): the header and the search box show at
 * once, and only the table waits behind `<Suspense>` with a skeleton of its own size.
 */
export default async function ProductsPage({ searchParams }: Props) {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const query = parseListQuery(await searchParams);
  const canRead = hasPermission(actor.roles, PERMISSIONS.catalog.productsRead);

  return (
    <Container asChild size="lg">
      <main className="py-10">
        <Stack gap={6}>
          <PageHeader
            title="Products"
            description="The catalogue: every product and its status."
            action={
              canRead ? (
                <Button asChild>
                  <a href="/products/new">New product</a>
                </Button>
              ) : null
            }
          />
          {canRead ? (
            <ListSearch
              action="/products"
              id="product-search"
              label="Search by CNK or name"
              q={query.q}
            />
          ) : null}
          {/* a new key per query, so a search or page change shows the placeholder again */}
          <Suspense key={`${query.q}|${query.page}`} fallback={<TableSkeleton columns={4} />}>
            <ProductsTable actor={actor} query={query} />
          </Suspense>
        </Stack>
      </main>
    </Container>
  );
}

async function ProductsTable({ actor, query }: { actor: ResolvedActor; query: ListQuery }) {
  const { q, page } = query;
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
  if (!result) {
    return (
      <Alert variant="error" title="You can't see the catalogue">
        {catalogErrorMessage(error ?? "kernel.forbidden")}
      </Alert>
    );
  }
  const pages = pageCount(result.total, PAGE_SIZE);

  return (
    <>
      {result.items.length === 0 ? (
        <EmptyState
          title={q ? `No products match “${q}”` : "No products yet"}
          data-testid="products-empty"
        />
      ) : (
        <ResponsiveTable>
          <caption className="sr-only">
            Products, page {result.page} of {pages}
          </caption>
          <TableHead>
            <TableRow className="border-b border-[var(--color-border-strong)]">
              <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                CNK
              </TableHeader>
              <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                Name (Dutch)
              </TableHeader>
              {priceOf ? (
                <TableHeader
                  scope="col"
                  className="py-2 pr-4 text-right font-semibold tabular-nums"
                >
                  Price
                </TableHeader>
              ) : null}
              <TableHeader scope="col" className="py-2 font-semibold">
                Status
              </TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {result.items.map((item) => (
              <TableRow key={item.id} className="border-b border-[var(--color-border)]">
                <TableCell label="CNK" className="py-2 pr-4">
                  <Link href={`/products/${item.id}`}>
                    <code>{item.cnk}</code>
                  </Link>
                </TableCell>
                <TableCell label="Name (Dutch)" className="py-2 pr-4">
                  {item.nameNl ?? (
                    <span className="text-[var(--color-text-subtle)]">No Dutch name yet</span>
                  )}
                </TableCell>
                {priceOf ? (
                  <TableCell label="Price" className="py-2 pr-4 text-right tabular-nums">
                    {priceOf.has(item.id) ? (
                      formatEuros(priceOf.get(item.id) ?? 0)
                    ) : (
                      <span className="sr-only">No price</span>
                    )}
                  </TableCell>
                ) : null}
                <TableCell label="Status" className="py-2">
                  <Badge variant={STATUS_BADGE[item.status]}>{STATUS_LABELS[item.status]}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </ResponsiveTable>
      )}

      <ListPager
        path="/products"
        q={q}
        page={result.page}
        pageSize={PAGE_SIZE}
        total={result.total}
        noun="product"
      />
    </>
  );
}
