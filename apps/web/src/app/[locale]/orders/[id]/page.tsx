import { isDomainError } from "@igs/kernel";
import { type OrderView, getOrder } from "@igs/module-orders";
import { logger } from "@igs/observability/logger";
import { Alert, Link, Price } from "@igs/ui";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { StorefrontFrame } from "../../../../components/storefront-frame";
import { statusMessageKey, uuidOf } from "../../../../lib/checkout-area";
import { cartActor, cartLocale } from "../../../../server/cart";
import { INTL_LOCALE } from "../../../../server/storefront";

interface Props {
  readonly params: Promise<{ locale: string; id: string }>;
}

export const metadata = { robots: { index: false, follow: false } };

/**
 * An order's page (igs-pharma#116, Sprint 3 E2), for its owner only: the reference to quote, where
 * it stands, what was ordered. Online payment is not wired yet (Mollie, S2): while the payment is
 * still `created` the page says so plainly, and nothing suggests the order was paid.
 */
export default async function OrderPage({ params }: Props) {
  const { locale: rawLocale, id } = await params;
  const locale = cartLocale(rawLocale);
  const orderId = uuidOf(id);
  if (!orderId) notFound();
  const t = await getTranslations({ locale, namespace: "order" });
  const intl = INTL_LOCALE[locale];

  let order: OrderView | null = null;
  try {
    const { actor, token } = await cartActor();
    order = await getOrder({ cartToken: token, orderId }, actor);
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
            {order.status === "pending_payment" && order.paymentStatus === "created" ? (
              <Alert variant="info" title={t("paymentSoon")} data-testid="payment-soon">
                {t("paymentSoonDetail")}
              </Alert>
            ) : null}
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
              <p className="flex items-baseline gap-2">
                <span className="font-semibold">{t("total")}</span>
                <Price cents={order.totalCents} locale={intl} vatLabel={t("vatIncluded")} />
              </p>
            </section>
            <Link href={`/${locale}`}>{t("continueShopping")}</Link>
          </>
        )}
      </div>
    </StorefrontFrame>
  );
}
