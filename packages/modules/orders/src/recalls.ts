import { type Ctx, type Tx, command, conflict, notFound, query } from "@igs/kernel";
import {
  type RecallCoverage,
  type RecallEndGuard,
  orderHoldersOfLots,
  recallCoverage,
} from "@igs/module-inventory";
import { PERMISSIONS } from "@igs/rbac";
import { and, asc, eq, exists, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { ORDERS_AUDIT } from "./audit";
import type { OrderStatus } from "./domain";
import { requestOrderMail } from "./mails";
import { orderContacts, orderLines, orderMails, ordersTable, payments } from "./schema";

/**
 * Recalls, part 2 (igs-pharma#189, REQ-SAF-01): the orders a recall affects, the notice to their
 * customers, and what must hold before the recall ends.
 *
 * - A recall of EVERY lot affects every order (not expired) that holds the product.
 * - A recall of CHOSEN lots affects the orders picked, or to be picked, from those lots: an order
 *   allocation that stands, was consumed, or was moved off them since the recall started
 *   (`orderHoldersOfLots`). An unpaid order has no allocation
 *   yet; the stop-sale already refuses its payment step (#182).
 *
 * The notice is the `recall_notice` order mail: one per paid order, through the outbox; it names the
 * order, never the product (no health data in a mail). A recall ends only when no affected order is
 * still open and every collected one was told (`recallEndGuard`, installed into inventory by each
 * composition root).
 */

/** An order's end states: nothing more happens to its goods. */
const CLOSED: readonly OrderStatus[] = ["collected", "cancelled", "expired"];

export type RecallNoticeState = "none" | "pending" | "sent" | "skipped";

export interface RecallAffectedOrder {
  readonly orderId: string;
  readonly reference: string;
  readonly status: OrderStatus;
  readonly placedAt: Date;
  readonly contactName: string | null;
  readonly contactEmail: string | null;
  /** Whether the order was paid (only a paid order gets the notice). */
  readonly paid: boolean;
  readonly notice: RecallNoticeState;
}

const isPaid = () =>
  exists(
    sql`(SELECT 1 FROM ${payments} WHERE ${payments.orderId} = ${ordersTable.id} AND ${payments.status} = 'paid')`,
  );

/** The ids of the orders the recall affects, oldest first. */
async function affectedOrderIds(tx: Tx, coverage: RecallCoverage): Promise<readonly string[]> {
  if (coverage.scope === "all_lots") {
    const rows = await tx
      .selectDistinct({ id: ordersTable.id, createdAt: ordersTable.createdAt })
      .from(ordersTable)
      .innerJoin(orderLines, eq(orderLines.orderId, ordersTable.id))
      .where(and(eq(orderLines.productId, coverage.productId), ne(ordersTable.status, "expired")))
      .orderBy(asc(ordersTable.createdAt), asc(ordersTable.id));
    return rows.map((row) => row.id);
  }
  const checkoutIds = (await orderHoldersOfLots(tx, coverage.lotIds, coverage.startedAt))
    .filter((holder) => holder.startsWith("checkout:"))
    .map((holder) => holder.slice("checkout:".length));
  if (checkoutIds.length === 0) return [];
  const rows = await tx
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(and(inArray(ordersTable.checkoutId, checkoutIds), ne(ordersTable.status, "expired")))
    .orderBy(asc(ordersTable.createdAt), asc(ordersTable.id));
  return rows.map((row) => row.id);
}

/** The affected orders with their customer and the state of their notice. */
async function affectedOrders(
  tx: Tx,
  coverage: RecallCoverage,
): Promise<readonly RecallAffectedOrder[]> {
  const ids = await affectedOrderIds(tx, coverage);
  if (ids.length === 0) return [];
  const rows = await tx
    .select({
      orderId: ordersTable.id,
      reference: ordersTable.reference,
      status: ordersTable.status,
      placedAt: ordersTable.createdAt,
      contactName: orderContacts.name,
      contactEmail: orderContacts.email,
      paid: sql<boolean>`${isPaid()}`,
      notice: orderMails.status,
    })
    .from(ordersTable)
    .leftJoin(orderContacts, eq(orderContacts.orderId, ordersTable.id))
    .leftJoin(
      orderMails,
      and(eq(orderMails.orderId, ordersTable.id), eq(orderMails.kind, "recall_notice")),
    )
    .where(inArray(ordersTable.id, [...ids]))
    .orderBy(asc(ordersTable.createdAt), asc(ordersTable.id));
  return rows.map((row) => ({
    ...row,
    status: row.status as OrderStatus,
    notice: (row.notice ?? "none") as RecallNoticeState,
  }));
}

const coverageOf = async (tx: Tx, recallId: string): Promise<RecallCoverage> => {
  const coverage = await recallCoverage(tx, recallId);
  if (!coverage) throw notFound("inventory.recall_not_found");
  return coverage;
};

/** Back-office: the orders a recall affects, oldest first (`inventory.recall_not_found`). */
export const listRecallAffectedOrders = query({
  name: "orders.recall.affected",
  input: z.object({ recallId: z.uuid() }),
  permission: PERMISSIONS.orders.read,
  async handler({ input, ctx }): Promise<readonly RecallAffectedOrder[]> {
    return affectedOrders(ctx.tx, await coverageOf(ctx.tx, input.recallId));
  },
});

/**
 * Sends the recall notice (pharmacist): one `recall_notice` mail per affected, PAID order that has
 * none yet. Unpaid orders are left out: they never reach the customer, and the stop-sale refuses their
 * payment. Sending again requests only what is missing.
 */
export const requestRecallNotices = command({
  name: "orders.recall.notify",
  input: z.object({ recallId: z.uuid() }),
  output: z.object({
    requested: z.number().int().min(0),
    affected: z.number().int().min(0),
  }),
  permission: PERMISSIONS.inventory.recallsManage,
  async handler({ input, ctx }) {
    const coverage = await coverageOf(ctx.tx, input.recallId);
    const orders = await affectedOrders(ctx.tx, coverage);
    const due = orders.filter((order) => order.paid && order.notice === "none");
    for (const order of due) {
      await requestOrderMail(ctx, { orderId: order.orderId, kind: "recall_notice" });
    }
    await ctx.audit.record({
      action: ORDERS_AUDIT.recallNoticesRequested,
      entityType: "product",
      entityId: coverage.productId,
      data: {
        recallId: coverage.recallId,
        productId: coverage.productId,
        requested: due.length,
        affected: orders.length,
      },
    });
    return { requested: due.length, affected: orders.length };
  },
});

/**
 * What must hold before a recall ends: no affected order still open (`orders.recall_orders_open`,
 * `count`), and every collected one told (`orders.recall_notices_missing`, `count`). Installed into
 * inventory with `configureRecallEndGuard(recallEndGuard)`.
 */
export const recallEndGuard: RecallEndGuard = async (ctx: Ctx, coverage: RecallCoverage) => {
  const orders = await affectedOrders(ctx.tx, coverage);
  const open = orders.filter((order) => !CLOSED.includes(order.status));
  if (open.length > 0) throw conflict("orders.recall_orders_open", { count: String(open.length) });
  const untold = orders.filter((order) => order.status === "collected" && order.notice === "none");
  if (untold.length > 0) {
    throw conflict("orders.recall_notices_missing", { count: String(untold.length) });
  }
};
