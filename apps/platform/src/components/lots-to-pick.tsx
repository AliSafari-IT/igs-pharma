import type { ResolvedActor } from "@igs/auth";
import { isDomainError } from "@igs/kernel";
import { type HolderAllocation, listHolderAllocations } from "@igs/module-inventory";
import type { StaffOrderView } from "@igs/module-orders";
import { PERMISSIONS, hasPermission } from "@igs/rbac";
import { Alert } from "@igs/ui";
import {
  ResponsiveTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./responsive-table";

import { formatDate, lotLabel } from "./stock-labels";

function ProductName({
  line,
  productId,
}: {
  readonly line: StaffOrderView["lines"][number] | undefined;
  readonly productId: string;
}) {
  return line ? (
    <>
      <code>{line.cnk}</code> {line.name}
    </>
  ) : (
    <code>{productId}</code>
  );
}

/**
 * The lots each line of a paid order is picked from (igs-pharma#165): earliest expiry first, as
 * allocated. A line not allocated in full is short of sellable stock and the order can't be packed.
 * Shown to staff who can read stock.
 */
export async function LotsToPick({
  order,
  actor,
}: {
  readonly order: StaffOrderView;
  readonly actor: ResolvedActor;
}) {
  if (!hasPermission(actor.roles, PERMISSIONS.inventory.stockRead)) return null;
  let allocations: readonly HolderAllocation[];
  try {
    allocations = await listHolderAllocations({ holderRef: order.holderRef }, actor);
  } catch (error) {
    // the rest of the order page stays usable when the lots can't be read
    if (!isDomainError(error)) throw error;
    return null;
  }
  if (allocations.length === 0) return null;
  const lineOf = new Map(order.lines.map((line) => [line.productId, line]));
  const short = allocations.filter((item) => item.allocated < item.quantity);

  return (
    <section className="flex flex-col gap-3" data-testid="lots-to-pick">
      <h2 className="font-display text-xl font-semibold">Lots to pick</h2>
      {short.length > 0 ? (
        <Alert variant="error" title="Not enough sellable stock" data-testid="allocation-short">
          {short.length === 1 ? "One product" : `${short.length} products`} can't be picked in full
          from sellable lots. The order can't be packed until stock comes in or a lot is released.
        </Alert>
      ) : null}
      <ResponsiveTable>
        <caption className="sr-only">Lots allocated to this order</caption>
        <TableHead>
          <TableRow className="border-b border-[var(--color-border-strong)]">
            <TableHeader scope="col" className="py-2 pr-4 font-semibold">
              Product
            </TableHeader>
            <TableHeader scope="col" className="py-2 pr-4 font-semibold">
              Lot
            </TableHeader>
            <TableHeader scope="col" className="py-2 pr-4 font-semibold">
              Expires
            </TableHeader>
            <TableHeader scope="col" className="py-2 text-right font-semibold tabular-nums">
              Qty
            </TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {allocations.flatMap((item) => {
            const line = lineOf.get(item.productId);
            const rows = item.lots.map((lot) => (
              <TableRow
                key={`${item.reservationId}-${lot.lotId}`}
                className="border-b border-[var(--color-border)]"
              >
                <TableCell label="Product" className="py-2 pr-4">
                  <ProductName line={line} productId={item.productId} />
                </TableCell>
                <TableCell label="Lot" className="py-2 pr-4">
                  {lotLabel(lot)}
                </TableCell>
                <TableCell label="Expires" className="py-2 pr-4">
                  {lot.expiryDate ? formatDate(lot.expiryDate) : "—"}
                </TableCell>
                <TableCell label="Qty" className="py-2 text-right tabular-nums">
                  {lot.quantity}
                </TableCell>
              </TableRow>
            ));
            const missing = item.quantity - item.allocated;
            if (missing > 0) {
              rows.push(
                <TableRow
                  key={`${item.reservationId}-short`}
                  className="border-b border-[var(--color-border)]"
                >
                  <TableCell label="Product" className="py-2 pr-4">
                    <ProductName line={line} productId={item.productId} />
                  </TableCell>
                  <TableCell
                    label="Lot / Expires"
                    className="py-2 pr-4 text-[var(--color-error-text)]"
                    colSpan={2}
                  >
                    No sellable lot
                  </TableCell>
                  <TableCell
                    label="Qty"
                    className="py-2 text-right tabular-nums text-[var(--color-error-text)]"
                  >
                    {missing}
                  </TableCell>
                </TableRow>,
              );
            }
            return rows;
          })}
        </TableBody>
      </ResponsiveTable>
    </section>
  );
}
