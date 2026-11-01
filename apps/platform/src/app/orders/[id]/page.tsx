import { isDomainError } from "@igs/kernel";
import { type StaffOrderView, getOrderForStaff } from "@igs/module-orders";
import { PERMISSIONS, hasPermission } from "@igs/rbac";
import { Alert, Badge, Container, Link, Stack } from "@igs/ui";
import type { ReactNode } from "react";

import { LotsToPick } from "../../../components/lots-to-pick";
import {
  CancelNotSellableForm,
  RefundForm,
  RetryLabelForm,
  ReviewForm,
  StepForm,
} from "../../../components/order-actions";
import {
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  REFUND_REASON_LABELS,
  REFUND_STATUS_BADGE,
  REFUND_STATUS_LABELS,
  REVIEW_DECISION_LABELS,
  SHIPMENT_STATUS_BADGE,
  SHIPMENT_STATUS_LABELS,
  nextSteps,
  orderErrorMessage,
  shipmentFailureMessage,
} from "../../../components/order-labels";
import { PageHeader } from "../../../components/page-header";
import { formatEuros } from "../../../components/price-labels";
import { formatMoment } from "../../../components/stock-labels";
import { StockShort } from "../../../components/stock-short";
import { requireStaffActor } from "../../../server/actor";
import { ensureKernelConfigured } from "../../../server/kernel";
import { shippingStatus } from "../../../server/shipping";

export const metadata = { title: "Order · IGS-Pharma Platform" };

interface Props {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<{ done?: string | string[] }>;
}

/** While its stock is set aside for it: the order is picked from its allocated lots (igs-pharma#165). */
const PICKING_STATUSES: ReadonlySet<string> = new Set([
  "in_review",
  "ready_to_prepare",
  "preparing",
  "ready_for_pickup",
  "ready_to_ship",
]);

/** Where staff cancel an order whose product stopped being sellable (as `cancelNotSellableOrder`). */
const NOT_SELLABLE_CANCELLABLE: ReadonlySet<string> = new Set([
  "ready_to_prepare",
  "preparing",
  "ready_for_pickup",
  "ready_to_ship",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function OrderPage({ params, searchParams }: Props) {
  const actor = await requireStaffActor();
  await ensureKernelConfigured();
  const { id } = await params;
  const done = first((await searchParams).done);

  let order: StaffOrderView | null = null;
  let error: string | null = null;
  if (!UUID.test(id)) {
    error = "orders.order_not_found";
  } else {
    try {
      order = await getOrderForStaff({ orderId: id }, actor);
    } catch (e) {
      if (!isDomainError(e)) throw e;
      error = e.code;
    }
  }
  if (!order) {
    return (
      <Container asChild size="lg">
        <main className="py-10">
          <Stack gap={6}>
            <Link href="/orders">Back to orders</Link>
            <Alert variant="error" title="You can't see this order">
              {orderErrorMessage(error ?? "kernel.forbidden")}
            </Alert>
          </Stack>
        </main>
      </Container>
    );
  }

  const canDecide =
    order.status === "in_review" && hasPermission(actor.roles, PERMISSIONS.orders.reviewDecide);
  // a medicine order's refund needs a pharmacist (the command checks it again)
  const canRefund =
    (order.refundDue || order.refundable) &&
    hasPermission(actor.roles, PERMISSIONS.orders.refundRequest) &&
    (!order.needsReview || hasPermission(actor.roles, PERMISSIONS.orders.reviewDecide));
  // the eligibility recheck: a product that stopped being sellable stops every step but the refusal
  const notSellable = new Set(order.notSellable);
  const blocked = notSellable.size > 0;
  const cancellableNotSellable = NOT_SELLABLE_CANCELLABLE.has(order.status);
  const canCancelNotSellable =
    blocked &&
    cancellableNotSellable &&
    hasPermission(actor.roles, PERMISSIONS.orders.refundRequest) &&
    (!order.needsReview || hasPermission(actor.roles, PERMISSIONS.orders.reviewDecide));
  const canManage = hasPermission(actor.roles, PERMISSIONS.orders.manage);
  // handing a parcel over waits for its label (the command refuses it too)
  const labelReady = order.shipment?.status === "created";
  const steps = nextSteps(order.status, order.deliveryMethod).filter(
    (to) => to !== "shipped" || labelReady,
  );
  // delivered/returned concern a parcel already gone: the sellability recheck no longer applies
  const canStep = (!blocked || order.status === "shipped") && steps.length > 0 && canManage;
  const shipping = order.deliveryMethod === "delivery" ? shippingStatus() : null;
  const who = (actorType: string, actorId: string) =>
    actorType === "user"
      ? actorId === actor.id
        ? "You"
        : "Staff member"
      : actorType === "anonymous"
        ? "Customer"
        : "System";

  return (
    <Container asChild size="lg">
      <main className="py-10">
        <Stack gap={6}>
          <PageHeader
            title={order.reference}
            back={{ href: "/orders", label: "Back to orders" }}
            description={
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant={ORDER_STATUS_BADGE[order.status]}>
                  {ORDER_STATUS_LABELS[order.status]}
                </Badge>
                {order.needsReview ? <Badge variant="neutral">Medicine</Badge> : null}
                Placed {formatMoment(order.createdAt)}
              </span>
            }
          />

          {done === "refund" ? (
            <Alert variant="success" title="Refund requested">
              The refund is sent to Mollie in the background. Its status shows below.
            </Alert>
          ) : null}
          {done === "reserved" || done === "cancelled" ? (
            <Alert variant="success" title="Saved">
              The order is now “{ORDER_STATUS_LABELS[order.status]}”. The customer is told by
              e-mail.
            </Alert>
          ) : null}
          {done === "label" ? (
            <Alert variant="success" title="Asked again">
              Sendcloud is asked for the label again in the background. Reload in a minute.
            </Alert>
          ) : null}
          {done === "review" || done === "step" ? (
            <Alert variant="success" title="Saved">
              The order is now “{ORDER_STATUS_LABELS[order.status]}”.
            </Alert>
          ) : null}
          {order.refundDue ? (
            <Alert variant="error" title="Refund due" data-testid="refund-due">
              This order was paid but is closed (cancelled or expired).{" "}
              {canRefund
                ? "Refund it below."
                : order.needsReview
                  ? "It holds a medicine: a pharmacist asks for its refund."
                  : "An owner or a pharmacist asks for its refund."}
            </Alert>
          ) : null}
          {order.status === "paid_stock_short" ? <StockShort order={order} actor={actor} /> : null}
          {blocked ? (
            <Alert
              variant="error"
              title="A product is no longer sellable"
              data-testid="not-sellable"
            >
              {notSellable.size === 1 ? "One product" : `${notSellable.size} products`} of this
              order can no longer be sold (made inactive, prescription-only, or its text no longer
              approved). The order can&apos;t be approved, prepared or handed over.{" "}
              {order.status === "in_review"
                ? "The pharmacist rejects it, which refunds it."
                : !cancellableNotSellable
                  ? "Once it is paid and its stock reserved, it goes to the pharmacist, who rejects it."
                  : canCancelNotSellable
                    ? "Cancel and refund it below."
                    : order.needsReview
                      ? "It holds a medicine: a pharmacist cancels and refunds it."
                      : "An owner or a pharmacist cancels and refunds it."}
            </Alert>
          ) : null}

          {canDecide ? (
            <Section title="Pharmacist review">
              <p>
                {blocked
                  ? "A product of this order is no longer sellable: reject it, which refunds it."
                  : "This order holds a medicine. Approve it before it is prepared."}
              </p>
              <ReviewForm orderId={order.orderId} version={order.version} blocked={blocked} />
            </Section>
          ) : null}
          {canRefund ? (
            <Section title="Refund">
              <p>
                {order.status === "returned"
                  ? "The parcel came back. If the customer gets their money back, the full amount goes back through Mollie."
                  : "The full amount goes back to the customer through Mollie."}
              </p>
              <RefundForm orderId={order.orderId} />
            </Section>
          ) : null}
          {canCancelNotSellable ? (
            <Section title="Cancel and refund">
              <p>
                The stock goes back and the full amount goes back to the customer through Mollie.
              </p>
              <CancelNotSellableForm orderId={order.orderId} version={order.version} />
            </Section>
          ) : null}
          {order.shipment ? (
            <Section title="Parcel">
              <div className="flex flex-col gap-2" data-testid="shipment">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant={SHIPMENT_STATUS_BADGE[order.shipment.status]}>
                    {SHIPMENT_STATUS_LABELS[order.shipment.status]}
                  </Badge>
                  {order.shipment.carrier ? <span>{order.shipment.carrier}</span> : null}
                  {order.shipment.trackingNumber ? (
                    <span>
                      Tracking <code>{order.shipment.trackingNumber}</code>
                    </span>
                  ) : null}
                </span>
                {order.shipment.status === "requested" ? (
                  <p className="text-[var(--color-text-subtle)]">
                    {shipping?.configured
                      ? "Sendcloud is making the label. Reload in a minute."
                      : "Sendcloud is not set up yet: the label is made once the owner adds the Sendcloud settings."}
                  </p>
                ) : null}
                {order.shipment.status === "failed" ? (
                  <Alert variant="error" title="No label" data-testid="label-failed">
                    {shipmentFailureMessage(order.shipment.failureCode)}
                  </Alert>
                ) : null}
                {labelReady && (order.status === "ready_to_ship" || order.status === "shipped") ? (
                  <p className="flex flex-wrap gap-4">
                    <Link href={`/orders/${order.orderId}/label`} data-testid="label-a4">
                      Print the label (A4)
                    </Link>
                    <Link href={`/orders/${order.orderId}/label?format=a6`}>
                      Label printer (A6)
                    </Link>
                  </p>
                ) : null}
                {order.shipment.trackingUrl ? (
                  <p>
                    <Link href={order.shipment.trackingUrl} rel="noreferrer" target="_blank">
                      Follow the parcel at the carrier
                    </Link>
                  </p>
                ) : null}
                {order.shipment.status === "failed" &&
                order.status === "ready_to_ship" &&
                canManage ? (
                  <RetryLabelForm orderId={order.orderId} />
                ) : null}
              </div>
            </Section>
          ) : null}
          {canStep ? (
            <Section title="Next step">
              {order.status === "shipped" ? (
                <p>
                  The carrier normally tells us when it is delivered. Mark it yourself only when it
                  doesn&apos;t, or when the parcel came back to the pharmacy (nothing goes back into
                  stock).
                </p>
              ) : null}
              <div className="flex flex-wrap gap-3">
                {steps.map((to, index) => (
                  <StepForm
                    key={to}
                    orderId={order.orderId}
                    version={order.version}
                    to={to}
                    secondary={index > 0}
                  />
                ))}
              </div>
            </Section>
          ) : null}

          {PICKING_STATUSES.has(order.status) && !blocked ? (
            <LotsToPick order={order} actor={actor} />
          ) : null}

          <Section title="Products">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--color-border-strong)]">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    CNK
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Product
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold tabular-nums">
                    Qty
                  </th>
                  <th scope="col" className="py-2 text-right font-semibold tabular-nums">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((line) => (
                  <tr key={line.productId} className="border-b border-[var(--color-border)]">
                    <td className="py-2 pr-4">
                      <code>{line.cnk}</code>
                    </td>
                    <td className="py-2 pr-4">
                      {line.name}
                      {line.isMedicine ? (
                        <>
                          {" "}
                          <Badge variant="neutral">Medicine</Badge>
                        </>
                      ) : null}
                      {notSellable.has(line.productId) ? (
                        <>
                          {" "}
                          <Badge variant="error">No longer sellable</Badge>
                        </>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{line.quantity}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatEuros(line.lineTotalCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {order.deliveryMethod === "delivery" ? (
                  <tr>
                    <th scope="row" colSpan={3} className="py-2 pr-4 text-right font-normal">
                      Home delivery
                    </th>
                    <td
                      className="py-2 text-right tabular-nums"
                      data-testid="staff-order-delivery-fee"
                    >
                      {order.deliveryFeeCents === 0 ? "Free" : formatEuros(order.deliveryFeeCents)}
                    </td>
                  </tr>
                ) : null}
                <tr>
                  <th scope="row" colSpan={3} className="py-2 pr-4 text-right font-semibold">
                    Total (VAT {formatEuros(order.vatCents)} included)
                  </th>
                  <td className="py-2 text-right font-semibold tabular-nums">
                    {formatEuros(order.totalCents)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </Section>

          <div className="grid gap-6 md:grid-cols-2">
            <Section title="Customer">
              {order.contact ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  <dt className="font-semibold">Name</dt>
                  <dd>{order.contact.name}</dd>
                  <dt className="font-semibold">E-mail</dt>
                  <dd>{order.contact.email}</dd>
                  <dt className="font-semibold">Phone</dt>
                  <dd>{order.contact.phone}</dd>
                  <dt className="font-semibold">Language</dt>
                  <dd>{order.locale.toUpperCase()}</dd>
                  <dt className="font-semibold">Handover</dt>
                  <dd data-testid="staff-order-method">
                    {order.deliveryMethod === "delivery"
                      ? "Home delivery"
                      : "Pick up in the pharmacy"}
                  </dd>
                  {order.deliveryAddress ? (
                    <>
                      <dt className="font-semibold">Address</dt>
                      <dd data-testid="staff-order-address">
                        {order.deliveryAddress.street}, {order.deliveryAddress.postalCode}{" "}
                        {order.deliveryAddress.city}
                      </dd>
                    </>
                  ) : null}
                </dl>
              ) : (
                <p className="text-[var(--color-text-subtle)]">No contact details.</p>
              )}
            </Section>
            <Section title="Payment">
              <p>
                {order.paymentStatus ? PAYMENT_STATUS_LABELS[order.paymentStatus] : "No payment"}
              </p>
              {order.review ? (
                <div data-testid="review-record">
                  <h3 className="font-semibold">Pharmacist review</h3>
                  <p>
                    {REVIEW_DECISION_LABELS[order.review.decision]} by{" "}
                    {order.review.reviewerId === actor.id ? "you" : "a pharmacist"},{" "}
                    {formatMoment(order.review.decidedAt)}
                  </p>
                  {order.review.note ? (
                    <p className="whitespace-pre-line text-[var(--color-text-subtle)]">
                      {order.review.note}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </Section>
          </div>

          {order.refunds.length > 0 ? (
            <Section title="Refunds">
              <ul className="flex flex-col gap-3" data-testid="refunds">
                {order.refunds.map((item) => (
                  <li key={item.refundId} className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge variant={REFUND_STATUS_BADGE[item.status]}>
                        {REFUND_STATUS_LABELS[item.status]}
                      </Badge>
                      {formatEuros(item.amountCents)} · {REFUND_REASON_LABELS[item.reason]} ·{" "}
                      {formatMoment(item.requestedAt)} ·{" "}
                      {who(item.requestedByType, item.requestedById)}
                    </span>
                    {item.providerRefundId ? (
                      <span className="text-[var(--color-text-subtle)]">
                        Mollie refund <code>{item.providerRefundId}</code>
                      </span>
                    ) : null}
                    {item.failureCode ? (
                      <span className="text-[var(--color-text-subtle)]">
                        Mollie refused it ({item.failureCode}). Check the payment in Mollie, then
                        ask again.
                      </span>
                    ) : null}
                    {item.note ? (
                      <span className="whitespace-pre-line text-[var(--color-text-subtle)]">
                        {item.note}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section title="History">
            <ol className="flex flex-col gap-1">
              {order.events.map((event) => (
                <li key={`${event.toStatus}-${event.at.toISOString()}`}>
                  {formatMoment(event.at)} · {ORDER_STATUS_LABELS[event.toStatus]} ·{" "}
                  {who(event.actorType, event.actorId)}
                </li>
              ))}
            </ol>
          </Section>
        </Stack>
      </main>
    </Container>
  );
}
