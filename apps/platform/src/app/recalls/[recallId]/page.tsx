import { isDomainError } from "@igs/kernel";
import { type RecallView, getRecall } from "@igs/module-inventory";
import { type RecallAffectedOrder, listRecallAffectedOrders } from "@igs/module-orders";
import { PERMISSIONS, hasPermission } from "@igs/rbac";
import { Alert, Badge, Container, Link, Stack } from "@igs/ui";
import {
  ResponsiveTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/responsive-table";

import { ORDER_STATUS_BADGE, ORDER_STATUS_LABELS } from "../../../components/order-labels";
import { PageHeader } from "../../../components/page-header";
import {
  DisposeDialog,
  EndRecallDialog,
  NotifyRecallDialog,
} from "../../../components/recall-dialogs";
import {
  DISPOSAL_METHOD_LABELS,
  RECALL_SCOPE_LABELS,
  RECALL_SOURCE_LABELS,
  formatDate,
  formatMoment,
  lotLabel,
  lotState,
  stockErrorMessage,
} from "../../../components/stock-labels";
import { requireStaffActor } from "../../../server/actor";
import { ensureKernelConfigured } from "../../../server/kernel";

export const metadata = { title: "Recall · IGS-Pharma Platform" };

interface Props {
  readonly params: Promise<{ recallId: string }>;
  readonly searchParams: Promise<{ done?: string | string[]; n?: string | string[] }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const DONE: Record<string, string> = {
  started: "The recall started: its lots are in quarantine and the product has stopped selling.",
  ended: "The recall ended: the product may sell again. Its lots stay in quarantine.",
  disposed: "The disposal was recorded: those units have left the stock.",
};

/** How far the notice to an order's customer got (igs-pharma#189). */
const NOTICE_LABELS: Record<RecallAffectedOrder["notice"], string> = {
  none: "Not sent",
  pending: "Sending",
  sent: "Sent",
  skipped: "Not sent (no usable address)",
};

/** One recall (igs-pharma#187): what it covers, who called it, its lots as they stand now. */
export default async function RecallPage({ params, searchParams }: Props) {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const { recallId } = await params;
  const query = await searchParams;
  const done = first(query.done) ?? "";
  const doneText =
    done === "notified"
      ? `The notice is on its way to ${Number(first(query.n) ?? 0)} customer(s).`
      : DONE[done];

  let recall: RecallView | null = null;
  let error: string | null = null;
  if (!UUID.test(recallId)) {
    error = "inventory.recall_not_found";
  } else {
    try {
      recall = await getRecall({ recallId }, actor);
    } catch (e) {
      if (!isDomainError(e)) throw e;
      error = e.code;
    }
  }
  if (!recall) {
    return (
      <Container asChild size="lg">
        <main className="py-10 [overflow-wrap:anywhere]">
          <Stack gap={6}>
            <Link href="/recalls">Back to recalls</Link>
            <Alert variant="error" title="You can't see this recall">
              {stockErrorMessage(error ?? "kernel.forbidden")}
            </Alert>
          </Stack>
        </main>
      </Container>
    );
  }
  const canRecall = hasPermission(actor.roles, PERMISSIONS.inventory.recallsManage);
  const canEnd = recall.endedAt === null && canRecall;
  const canSeeOrders = hasPermission(actor.roles, PERMISSIONS.orders.read);
  const affected = canSeeOrders
    ? await listRecallAffectedOrders({ recallId: recall.recallId }, actor)
    : [];
  const due = affected.filter((order) => order.paid && order.notice === "none").length;
  const lotNames = new Map(recall.lots.map((lot) => [lot.lotId, lotLabel(lot)]));
  const who = (id: string | null) => (id === actor.id ? "you" : "a pharmacist");

  return (
    <Container asChild size="lg">
      <main className="py-10 [overflow-wrap:anywhere]">
        <Stack gap={6}>
          <PageHeader
            title={`Recall: ${recall.nameNl ?? "No Dutch name yet"}`}
            back={{ href: "/recalls", label: "Back to recalls" }}
            description={
              <>
                CNK <code>{recall.cnk}</code> ·{" "}
                <Link href={`/stock/${recall.productId}`}>Stock of this product</Link>
              </>
            }
            action={canEnd ? <EndRecallDialog recallId={recall.recallId} /> : undefined}
          />

          {doneText ? (
            <Alert variant="success" title="Saved">
              {doneText}
            </Alert>
          ) : null}

          {recall.endedAt ? (
            <Alert variant="info" title="This recall has ended">
              Ended {formatMoment(recall.endedAt)} by {who(recall.endedById)}. The product may sell
              again; its recalled lots stay in quarantine until a pharmacist releases them.
            </Alert>
          ) : (
            <Alert
              variant="error"
              title="Active: the product is not selling"
              data-testid="recall-active"
            >
              It is off the webshop, and orders holding it can't be paid, approved or packed.
            </Alert>
          )}

          <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-[max-content_1fr]">
            <dt className="font-semibold">Called by</dt>
            <dd>{RECALL_SOURCE_LABELS[recall.source]}</dd>
            <dt className="font-semibold">Reference and reason</dt>
            <dd className="whitespace-pre-wrap" data-testid="recall-note">
              {recall.note}
            </dd>
            <dt className="font-semibold">Lots</dt>
            <dd>
              {RECALL_SCOPE_LABELS[recall.scope]} ({recall.lotCount})
            </dd>
            <dt className="font-semibold">Started</dt>
            <dd>
              {formatMoment(recall.startedAt)} by {who(recall.startedById)}
            </dd>
          </dl>

          <section aria-labelledby="recall-lots-title" className="flex flex-col gap-3">
            <h2 id="recall-lots-title" className="font-display text-2xl font-semibold">
              Recalled lots
            </h2>
            {recall.lots.length === 0 ? (
              <p className="text-[var(--color-text-subtle)]">
                The product had no lots when the recall started.
              </p>
            ) : (
              <ResponsiveTable data-testid="recall-lots">
                <caption className="sr-only">The lots this recall covers</caption>
                <TableHead>
                  <TableRow className="border-b border-[var(--color-border-strong)]">
                    <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                      Lot
                    </TableHeader>
                    <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                      Expires
                    </TableHeader>
                    <TableHeader
                      scope="col"
                      className="py-2 pr-4 text-right font-semibold tabular-nums"
                    >
                      On hand
                    </TableHeader>
                    <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                      State
                    </TableHeader>
                    <TableHeader scope="col" className="py-2 font-semibold">
                      <span className="sr-only">Actions</span>
                    </TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {recall.lots.map((lot) => {
                    const state = lotState(lot);
                    return (
                      <TableRow key={lot.lotId} className="border-b border-[var(--color-border)]">
                        <TableCell label="Lot" className="py-2 pr-4">
                          <code>{lotLabel(lot)}</code>
                        </TableCell>
                        <TableCell label="Expires" className="py-2 pr-4">
                          {lot.expiryDate ? formatDate(lot.expiryDate) : "—"}
                        </TableCell>
                        <TableCell label="On hand" className="py-2 pr-4 text-right tabular-nums">
                          {lot.onHand}
                        </TableCell>
                        <TableCell label="State" className="py-2 pr-4">
                          <Badge variant={state.variant}>{state.label}</Badge>
                        </TableCell>
                        <TableCell label="Actions" stacked className="py-2">
                          {canRecall && lot.onHand > 0 ? (
                            <DisposeDialog
                              recallId={recall.recallId}
                              lotId={lot.lotId}
                              lotName={lotLabel(lot)}
                              onHand={lot.onHand}
                            />
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </ResponsiveTable>
            )}
          </section>

          {recall.disposals.length > 0 ? (
            <section aria-labelledby="disposals-title" className="flex flex-col gap-3">
              <h2 id="disposals-title" className="font-display text-2xl font-semibold">
                Disposals
              </h2>
              <ul className="flex flex-col gap-1" data-testid="recall-disposals">
                {recall.disposals.map((d) => (
                  <li key={d.disposalId}>
                    {formatMoment(d.recordedAt)}: {d.quantity} of{" "}
                    <code>{lotNames.get(d.lotId) ?? "a lot"}</code>,{" "}
                    {DISPOSAL_METHOD_LABELS[d.method].toLowerCase()}
                    {d.note ? ` (${d.note})` : ""}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {canSeeOrders ? (
            <section aria-labelledby="affected-title" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="affected-title" className="font-display text-2xl font-semibold">
                  Affected orders
                </h2>
                {canRecall && due > 0 ? (
                  <NotifyRecallDialog recallId={recall.recallId} due={due} />
                ) : null}
              </div>
              <p className="text-[var(--color-text-subtle)]">
                {recall.scope === "all_lots"
                  ? "Every order that holds this product."
                  : "The orders picked, or to be picked, from the recalled lots."}{" "}
                The recall ends only once none is open and every customer who collected one was
                told.
              </p>
              {affected.length === 0 ? (
                <p data-testid="affected-empty">No order is affected.</p>
              ) : (
                <ResponsiveTable data-testid="affected-orders">
                  <caption className="sr-only">Orders this recall affects, oldest first</caption>
                  <TableHead>
                    <TableRow className="border-b border-[var(--color-border-strong)]">
                      <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                        Order
                      </TableHeader>
                      <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                        Status
                      </TableHeader>
                      <TableHeader scope="col" className="py-2 pr-4 font-semibold">
                        Customer
                      </TableHeader>
                      <TableHeader scope="col" className="py-2 font-semibold">
                        Notice
                      </TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {affected.map((order) => (
                      <TableRow
                        key={order.orderId}
                        className="border-b border-[var(--color-border)]"
                      >
                        <TableCell label="Order" className="py-2 pr-4">
                          <Link href={`/orders/${order.orderId}`}>
                            <code>{order.reference}</code>
                          </Link>
                        </TableCell>
                        <TableCell label="Status" className="py-2 pr-4">
                          <Badge variant={ORDER_STATUS_BADGE[order.status]}>
                            {ORDER_STATUS_LABELS[order.status]}
                          </Badge>
                        </TableCell>
                        <TableCell label="Customer" className="py-2 pr-4">
                          {order.contactName ?? "—"}
                          {order.contactEmail ? (
                            <span className="block text-sm text-[var(--color-text-subtle)]">
                              {order.contactEmail}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell label="Notice" className="py-2">
                          {order.paid ? NOTICE_LABELS[order.notice] : "Not paid: no notice"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </ResponsiveTable>
              )}
            </section>
          ) : null}
        </Stack>
      </main>
    </Container>
  );
}
