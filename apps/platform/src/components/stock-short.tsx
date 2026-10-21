import type { ResolvedActor } from "@igs/auth";
import { isDomainError } from "@igs/kernel";
import {
  type HolderReservation,
  type ReservationStatus,
  getStock,
  listHolderReservations,
} from "@igs/module-inventory";
import { STOCK_SHORT_DEADLINE_HOURS, type StaffOrderView } from "@igs/module-orders";
import { PERMISSIONS, hasPermission } from "@igs/rbac";
import { Alert, Badge, type BadgeVariant } from "@igs/ui";

import { CancelStockShortForm, ReReserveForm } from "./order-actions";
import { formatMoment } from "./stock-labels";

/** Back-office text for a stock hold's status (igs-pharma#158). */
const HOLD_LABELS: Record<ReservationStatus, string> = {
  active: "Held",
  expired: "Hold ended",
  released: "Given back",
  consumed: "Handed out",
};
const HOLD_BADGE: Record<ReservationStatus, BadgeVariant> = {
  active: "success",
  expired: "error",
  released: "neutral",
  consumed: "neutral",
};

/** What is available of each product now; `null` when it could not be read. */
async function availableOf(
  productIds: readonly string[],
  actor: ResolvedActor,
): Promise<Map<string, number | null>> {
  const entries = await Promise.all(
    productIds.map(async (productId): Promise<[string, number | null]> => {
      try {
        return [productId, (await getStock({ productId }, actor)).available];
      } catch (error) {
        if (!isDomainError(error)) throw error;
        return [productId, null];
      }
    }),
  );
  return new Map(entries);
}

/**
 * A paid order whose stock holds ended before the payment came in (igs-pharma#158): each line with
 * what was ordered, what is available now and what became of its hold; then the two ways out:
 * reserve the same products again, or cancel and refund. Nothing is substituted.
 */
export async function StockShort({
  order,
  actor,
}: {
  readonly order: StaffOrderView;
  readonly actor: ResolvedActor;
}) {
  const can = (permission: Parameters<typeof hasPermission>[1]) =>
    hasPermission(actor.roles, permission);
  const seesStock = can(PERMISSIONS.inventory.stockRead);
  const available = seesStock
    ? await availableOf(
        order.lines.map((line) => line.productId),
        actor,
      )
    : new Map<string, number | null>();
  const holds: readonly HolderReservation[] = seesStock
    ? await listHolderReservations({ holderRef: order.holderRef }, actor)
    : [];
  const now = new Date();
  /** The line's latest hold, as it stands now: a hold whose time is up has ended, marked or not. */
  const holdOf = (productId: string): ReservationStatus | undefined => {
    const hold = holds.find((item) => item.productId === productId);
    if (!hold) return undefined;
    return hold.status === "active" && hold.expiresAt !== null && hold.expiresAt <= now
      ? "expired"
      : hold.status;
  };
  const allThere =
    seesStock &&
    order.lines.every((line) => {
      const free = available.get(line.productId);
      return (
        (holdOf(line.productId) === "active" ? line.quantity : 0) + (free ?? 0) >= line.quantity
      );
    });
  const canReReserve = can(PERMISSIONS.orders.manage);
  const canCancel =
    can(PERMISSIONS.orders.refundRequest) &&
    (!order.needsReview || can(PERMISSIONS.orders.reviewDecide));

  return (
    <section className="flex flex-col gap-3" data-testid="stock-short">
      <h2 className="font-display text-xl font-semibold">Paid, stock short</h2>
      <Alert variant="error" title="The payment came in after the stock hold ended">
        The customer was told their payment arrived and the pharmacy is looking at the order.
        Reserve the same products again, or cancel and refund. Never swap a product.
      </Alert>
      {order.stockShort ? (
        <p data-testid="stock-short-since">
          Waiting since {formatMoment(order.stockShort.since)}.{" "}
          {order.stockShort.overdue ? (
            <strong>
              Past the {STOCK_SHORT_DEADLINE_HOURS}-hour deadline: resolve it now, the customer has
              paid and is waiting.
            </strong>
          ) : (
            `Resolve it within ${STOCK_SHORT_DEADLINE_HOURS} hours.`
          )}
        </p>
      ) : null}
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[var(--color-border-strong)]">
            <th scope="col" className="py-2 pr-4 font-semibold">
              Product
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-semibold tabular-nums">
              Ordered
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-semibold tabular-nums">
              Available now
            </th>
            <th scope="col" className="py-2 font-semibold">
              Hold
            </th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => {
            const free = available.get(line.productId);
            const hold = holdOf(line.productId);
            return (
              <tr key={line.productId} className="border-b border-[var(--color-border)]">
                <td className="py-2 pr-4">
                  <code>{line.cnk}</code> {line.name}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">{line.quantity}</td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {free === undefined || free === null ? "—" : free}
                </td>
                <td className="py-2">
                  {hold ? <Badge variant={HOLD_BADGE[hold]}>{HOLD_LABELS[hold]}</Badge> : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {seesStock && !allThere ? (
        <p>Not every product is available in the quantity ordered.</p>
      ) : null}
      <div className="grid gap-6 md:grid-cols-2">
        {canReReserve ? (
          <div className="flex flex-col gap-2">
            <h3 className="font-semibold">The stock is there</h3>
            <p>
              {order.needsReview
                ? "The order then goes to the pharmacist's review."
                : "The order then goes to “To prepare”."}{" "}
              The customer is told the pharmacy is checking it.
            </p>
            <ReReserveForm orderId={order.orderId} version={order.version} />
          </div>
        ) : null}
        {canCancel ? (
          <div className="flex flex-col gap-2">
            <h3 className="font-semibold">The stock won't come</h3>
            <p>The order is cancelled and the full amount refunded; the customer is told.</p>
            <CancelStockShortForm orderId={order.orderId} version={order.version} />
          </div>
        ) : order.needsReview && can(PERMISSIONS.orders.refundRequest) ? (
          <p>It holds a medicine: a pharmacist cancels and refunds it.</p>
        ) : null}
      </div>
    </section>
  );
}
