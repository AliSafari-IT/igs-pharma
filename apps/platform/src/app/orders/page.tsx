import type { ResolvedActor } from "@igs/auth";
import { isDomainError } from "@igs/kernel";
import { type OrderStatus, type StaffOrderPage, listOrdersForStaff } from "@igs/module-orders";
import { Alert, Badge, Container, EmptyState, Link, Stack } from "@igs/ui";
import { Suspense } from "react";

import {
  ORDER_QUEUES,
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABELS,
  orderErrorMessage,
} from "../../components/order-labels";
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
import { formatMoment } from "../../components/stock-labels";
import { TableSkeleton } from "../../components/table-skeleton";
import { pageCount } from "../../lib/list-query";
import { requireStaffActor } from "../../server/actor";
import { ensureKernelConfigured } from "../../server/kernel";

export const metadata = { title: "Orders · IGS-Pharma Platform" };

const PAGE_SIZE = 25;

interface Props {
  readonly searchParams: Promise<{ status?: string | string[]; page?: string | string[] }>;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const statusOf = (value: string | undefined): OrderStatus | undefined =>
  (ORDER_QUEUES as readonly string[]).includes(value ?? "") ? (value as OrderStatus) : undefined;

const href = (status: OrderStatus | undefined, page = 1) =>
  `/orders?${new URLSearchParams({ ...(status ? { status } : {}), ...(page > 1 ? { page: String(page) } : {}) })}`;

export default async function OrdersPage({ searchParams }: Props) {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const params = await searchParams;
  const status = statusOf(first(params.status));
  const pageText = first(params.page);
  const page = pageText && /^[0-9]{1,4}$/.test(pageText) ? Math.max(1, Number(pageText)) : 1;

  return (
    <Container asChild size="lg">
      <main className="py-10">
        <Stack gap={6}>
          <PageHeader
            title="Orders"
            description="Paid orders move from pharmacist review (medicines) to preparation and pickup."
          />
          <Suspense key={`${status ?? ""}|${page}`} fallback={<TableSkeleton columns={6} />}>
            <OrdersTable actor={actor} status={status} page={page} />
          </Suspense>
        </Stack>
      </main>
    </Container>
  );
}

async function OrdersTable({
  actor,
  status,
  page,
}: {
  actor: ResolvedActor;
  status: OrderStatus | undefined;
  page: number;
}) {
  let result: StaffOrderPage | null = null;
  let error: string | null = null;
  try {
    result = await listOrdersForStaff(
      { ...(status ? { status } : {}), page, pageSize: PAGE_SIZE },
      actor,
    );
  } catch (e) {
    if (!isDomainError(e)) throw e;
    error = e.code;
  }
  if (!result) {
    return (
      <Alert variant="error" title="You can't see the orders">
        {orderErrorMessage(error ?? "kernel.forbidden")}
      </Alert>
    );
  }
  const pages = pageCount(result.total, PAGE_SIZE);
  const all = Object.values(result.counts).reduce((sum, n) => sum + (n ?? 0), 0);

  return (
    <>
      <nav aria-label="Order queues">
        <ul className="flex flex-wrap gap-2">
          {[undefined, ...ORDER_QUEUES].map((queue) => {
            const current = queue === status;
            return (
              <li key={queue ?? "all"}>
                <Link
                  href={href(queue)}
                  aria-current={current ? "page" : undefined}
                  className={current ? "font-semibold" : undefined}
                >
                  {queue ? ORDER_STATUS_LABELS[queue] : "All"} (
                  {queue ? (result.counts[queue] ?? 0) : all})
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {result.items.length === 0 ? (
        <EmptyState
          title={status ? `No orders in “${ORDER_STATUS_LABELS[status]}”` : "No orders yet"}
          data-testid="orders-empty"
        />
      ) : (
        <ResponsiveTable>
          <caption className="sr-only">
            Orders, page {result.page} of {pages}
          </caption>
          <TableHead>
            <TableRow className="border-b border-[var(--color-border-strong)]">
              <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                Reference
              </TableHeader>
              <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                Placed
              </TableHeader>
              <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                Customer
              </TableHeader>
              <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                Status
              </TableHeader>
              <TableHeader scope="col" className="py-2 text-right font-semibold tabular-nums">
                Total
              </TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {result.items.map((item) => (
              <TableRow key={item.orderId} className="border-b border-[var(--color-border)]">
                <TableCell label="Reference" className="py-2 pr-4">
                  <Link href={`/orders/${item.orderId}`}>
                    <code>{item.reference}</code>
                  </Link>
                </TableCell>
                <TableCell label="Placed" className="py-2 pr-4">
                  {formatMoment(item.createdAt)}
                </TableCell>
                <TableCell label="Customer" className="py-2 pr-4">
                  {item.contactName ?? "—"}
                </TableCell>
                <TableCell label="Status" className="py-2 pr-4">
                  <span className="flex flex-wrap gap-1">
                    <Badge variant={ORDER_STATUS_BADGE[item.status]}>
                      {ORDER_STATUS_LABELS[item.status]}
                    </Badge>
                    {item.needsReview ? <Badge variant="neutral">Medicine</Badge> : null}
                    {item.refundDue ? <Badge variant="error">Refund due</Badge> : null}
                  </span>
                </TableCell>
                <TableCell label="Total" className="py-2 text-right tabular-nums">
                  {formatEuros(item.totalCents)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </ResponsiveTable>
      )}

      {pages > 1 ? (
        <nav aria-label="Pages" className="flex gap-4">
          {result.page > 1 ? <Link href={href(status, result.page - 1)}>Previous page</Link> : null}
          <span>
            Page {result.page} of {pages}
          </span>
          {result.page < pages ? <Link href={href(status, result.page + 1)}>Next page</Link> : null}
        </nav>
      ) : null}
    </>
  );
}
