import { isDomainError } from "@igs/kernel";
import { type OrderView, getOrder } from "@igs/module-orders";
import { logger } from "@igs/observability/logger";
import { Alert, Button, Link, Price } from "@igs/ui";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { StorefrontFrame } from "../../../../components/storefront-frame";
import {
  payReturnOf,
  paymentNoticeOf,
  statusMessageKey,
  statusTokenOf,
  uuidOf,
} from "../../../../lib/checkout-area";
import { cartActor, cartLocale } from "../../../../server/cart";
import { paymentsSetup, refreshPayment } from "../../../../server/payments";
import { INTL_LOCALE } from "../../../../server/storefront";

interface Props {
  readonly params: Promise<{ locale: string; id: string }>;
  readonly searchParams: Promise<{ payment?: string | string[]; t?: string | string[] }>;
}

/** Payment statuses that may have moved on at Mollie since we last heard. */
const UNSETTLED = new Set(["open", "pending", "authorized"]);

export const metadata = { robots: { index: false, follow: false } };

/**
 * An order's page (igs-pharma#116, Sprint 3 E2), for its owner only: the reference to quote, where
 * it stands, what was ordered. While the order waits for payment it offers "Pay now" (a link to
 * `./pay`, which sends the shopper to Mollie); without payment configured it says so plainly, and
 * nothing suggests the order was paid. Mollie sends the shopper back here, so an unsettled payment
 * is re-read once on view.
 */
export default async function OrderPage({ params, searchParams }: Props) {
  const { locale: rawLocale, id } = await params;
  const query = await searchParams;
  const payReturn = payReturnOf(query.payment);
  const statusToken = statusTokenOf(query.t);
  const locale = cartLocale(rawLocale);
  const orderId = uuidOf(id);
  if (!orderId) notFound();
  const t = await getTranslations({ locale, namespace: "order" });
  const intl = INTL_LOCALE[locale];

  const payments = paymentsSetup();
  let order: OrderView | null = null;
  try {
    const { actor, token } = await cartActor();
    const read = { cartToken: token, orderId, ...(statusToken ? { statusToken } : {}) };
    order = await getOrder(read, actor);
    if (
      payments &&
      order.status === "pending_payment" &&
      order.paymentStatus &&
      UNSETTLED.has(order.paymentStatus)
    ) {
      await refreshPayment(orderId, payments);
      order = await getOrder(read, actor);
    }
  } catch (error) {
    if (isDomainError(error) && error.code === "orders.order_not_found") notFound();
    logger.error({ event: "storefront.order_failed", err: error }, "storefront.order_failed");
  }

  return (
    <StorefrontFrame locale={locale} path={`/orders/${orderId}`}>
      <div className="flex flex-col gap-6">
        {!order ? (
          <Alert variant="error" title={t("unavailable")} />
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <h1 className="font-display text-3xl font-medium text-[var(--color-primary)]">
                {t("title")}
              </h1>
              <p>
                {t("reference")}{" "}
                <strong data-testid="order-reference" className="tabular-nums">
                  {order.reference}
                </strong>
              </p>
              <p data-testid="order-status">
                {t("status")}: <strong>{t(statusMessageKey(order.status))}</strong>
              </p>
            </div>
            {statusToken ? (
              <Alert variant="info" title={t("statusLinkTitle")} data-testid="status-link">
                {t("statusLinkBody")}
              </Alert>
            ) : null}
            {payReturn === "unavailable" ? (
              <Alert
                variant="error"
                title={t("paymentUnavailable")}
                data-testid="payment-unavailable"
              >
                {t("paymentUnavailableDetail")}
              </Alert>
            ) : null}
            <PaymentNotice
              notice={paymentNoticeOf(order.status, order.paymentStatus, payments !== null)}
              payHref={`/${locale}/orders/${orderId}/pay${statusToken ? `?t=${statusToken}` : ""}`}
              cartHref={`/${locale}/cart`}
              t={t}
            />
            {order.needsReview ? (
              <div
                role="note"
                className="rounded-[var(--radius-md)] border-l-4 border-[var(--color-accent)] bg-[var(--color-accent-subtle)] p-4 text-[var(--color-text)]"
              >
                {t("pharmacistReview")}
              </div>
            ) : null}
            <section aria-labelledby="order-lines" className="flex flex-col gap-3">
              <h2 id="order-lines" className="font-display text-xl font-semibold">
                {t("lines")}
              </h2>
              <ul className="flex flex-col divide-y divide-[var(--color-border)]">
                {order.lines.map((line) => (
                  <li key={line.productId} className="flex flex-wrap justify-between gap-2 py-3">
                    <span>
                      {line.quantity} × {line.name}
                    </span>
                    <Price cents={line.lineTotalCents} locale={intl} />
                  </li>
                ))}
              </ul>
              {order.deliveryMethod === "delivery" ? (
                <p className="flex items-baseline gap-2" data-testid="order-delivery-fee">
                  <span>{t("deliveryCost")}</span>
                  {order.deliveryFeeCents === 0 ? (
                    <strong>{t("deliveryFree")}</strong>
                  ) : (
                    <Price cents={order.deliveryFeeCents} locale={intl} />
                  )}
                </p>
              ) : null}
              <p className="flex items-baseline gap-2">
                <span className="font-semibold">{t("total")}</span>
                <Price cents={order.totalCents} locale={intl} vatLabel={t("vatIncluded")} />
              </p>
            </section>
            {order.deliveryMethod === "delivery" && order.deliveryAddress ? (
              <section aria-labelledby="order-delivery" className="flex flex-col gap-2">
                <h2 id="order-delivery" className="font-display text-xl font-semibold">
                  {t("deliveryTitle")}
                </h2>
                <p>{t("deliveryHome")}</p>
                <address className="not-italic" data-testid="order-delivery-address">
                  {order.deliveryAddress.street}
                  <br />
                  {order.deliveryAddress.postalCode} {order.deliveryAddress.city}
                </address>
              </section>
            ) : null}
            <Link href={`/${locale}`}>{t("continueShopping")}</Link>
          </>
        )}
      </div>
    </StorefrontFrame>
  );
}

function PaymentNotice({
  notice,
  payHref,
  cartHref,
  t,
}: {
  readonly notice: ReturnType<typeof paymentNoticeOf>;
  readonly payHref: string;
  readonly cartHref: string;
  readonly t: (key: string) => string;
}) {
  switch (notice) {
    case "pay":
      return (
        <div className="flex flex-col items-start gap-3" data-testid="payment-pay">
          <p>{t("payDetail")}</p>
          {/* a plain link, never prefetched: following it starts the payment */}
          <Button asChild variant="primary" size="lg">
            <a href={payHref}>{t("payNow")}</a>
          </Button>
        </div>
      );
    case "paymentSoon":
      return (
        <Alert variant="info" title={t("paymentSoon")} data-testid="payment-soon">
          {t("paymentSoonDetail")}
        </Alert>
      );
    case "paymentProcessing":
      return (
        <Alert variant="info" title={t("paymentProcessing")} data-testid="payment-processing">
          {t("paymentProcessingDetail")}
        </Alert>
      );
    case "paymentFailed":
      return (
        <Alert variant="error" title={t("paymentFailed")} data-testid="payment-failed">
          {t("paymentFailedDetail")} <Link href={cartHref}>{t("backToCart")}</Link>
        </Alert>
      );
    case "stockShort":
      return (
        <Alert variant="info" title={t("stockShort")} data-testid="payment-stock-short">
          {t("stockShortDetail")}
        </Alert>
      );
    default:
      return null;
  }
}
