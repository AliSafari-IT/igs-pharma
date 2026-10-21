import type { ResolvedActor } from "@igs/auth";
import { isDomainError } from "@igs/kernel";
import {
  type StockPage,
  getInventorySettings,
  listOpenReconciliations,
  listStock,
} from "@igs/module-inventory";
import { PERMISSIONS, hasPermission } from "@igs/rbac";
import { Alert, Badge, Container, EmptyState, Link, Stack } from "@igs/ui";
import { Suspense } from "react";

import { CountUpload } from "../../components/count-upload";
import { ListPager } from "../../components/list-pager";
import { ListSearch } from "../../components/list-search";
import { ExpiryBufferForm } from "../../components/lot-dialogs";
import { PageHeader } from "../../components/page-header";
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
    buffer?: string | string[];
  }>;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The back-office stock list (igs-pharma#53): on-hand per product, by CNK, and counting the web
 * stock (igs-pharma#166: a count file, previewed before anything changes).
 *
 * The sign-in check runs BEFORE anything streams (#142): the header, the notices and the search box
 * show at once; only the table waits behind `<Suspense>`.
 */
export default async function StockListPage({ searchParams }: Props) {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const params = await searchParams;
  const query = parseListQuery(params);
  const canRead = hasPermission(actor.roles, PERMISSIONS.inventory.stockRead);
  const canSetBuffer = hasPermission(actor.roles, PERMISSIONS.inventory.settingsManage);
  const canCount = hasPermission(actor.roles, PERMISSIONS.inventory.stockManage);
  const settings = canRead ? await getInventorySettings({}, actor) : null;

  return (
    <Container asChild size="lg">
      <main className="py-10">
        <Stack gap={6}>
          <PageHeader
            title="Stock"
            description="The web shop's stock, per product and lot. Open a product to receive stock, adjust it or manage its lots."
          />

          {first(params.buffer) === "1" ? (
            <Alert variant="success" title="Saved">
              Lots now stop selling {settings?.expiryBufferDays} days before they expire.
            </Alert>
          ) : null}

          {settings ? (
            canSetBuffer ? (
              <ExpiryBufferForm days={settings.expiryBufferDays} />
            ) : (
              <p className="text-[var(--color-text-subtle)]" data-testid="expiry-buffer-text">
                A lot stops selling {settings.expiryBufferDays} days before it expires (the titular
                pharmacist sets this).
              </p>
            )
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

          {canRead && canCount ? <Counts actor={actor} /> : null}
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
                    {item.flaggedLots > 0 ? (
                      <>
                        {" "}
                        <Badge variant="error">
                          {item.flaggedLots === 1
                            ? "1 lot can't be sold"
                            : `${item.flaggedLots} lots can't be sold`}
                        </Badge>
                      </>
                    ) : null}
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
    </>
  );
}

/**
 * Counting the web stock (igs-pharma#166): upload a count file, or count one product's lots on its
 * page. Each count is previewed first; the open ones wait here until they are applied or discarded.
 */
async function Counts({ actor }: { actor: ResolvedActor }) {
  const open = await listOpenReconciliations({}, actor);
  return (
    <section aria-labelledby="counts-title" className="flex flex-col gap-4" data-testid="counts">
      <h2 id="counts-title" className="font-display text-2xl font-semibold">
        Count the stock
      </h2>
      <p className="text-[var(--color-text-subtle)]">
        One line per lot: <code>CNK;lot;expiry;counted</code>. Leave lot and expiry empty for a
        product kept without lots; the expiry date is only needed when two lots share a number. You
        see every difference before anything changes.
      </p>
      <CountUpload />
      {open.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">Counts waiting to be applied</h3>
          <ul className="flex flex-col gap-1">
            {open.map((count) => (
              <li key={count.reconciliationId}>
                <Link href={`/stock/counts/${count.reconciliationId}`}>
                  {count.source === "csv" ? "Count file" : "Typed count"} of{" "}
                  {formatMoment(count.startedAt)}
                </Link>{" "}
                <span className="text-[var(--color-text-subtle)]">
                  ({count.lines} lot{count.lines === 1 ? "" : "s"})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
