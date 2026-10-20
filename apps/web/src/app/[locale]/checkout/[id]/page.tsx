import { PHARMACY_IDENTITY } from "@igs/config";
import { isDomainError } from "@igs/kernel";
import { type CheckoutView, getCheckout } from "@igs/module-orders";
import { logger } from "@igs/observability/logger";
import { Alert, Button, Link, Price } from "@igs/ui";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

import { CheckoutForm } from "../../../../components/checkout/checkout-form";
import { StorefrontFrame } from "../../../../components/storefront-frame";
import { brusselsTime, uuidOf } from "../../../../lib/checkout-area";
import { cartActor, cartLocale } from "../../../../server/cart";
import { INTL_LOCALE } from "../../../../server/storefront";
import { startCheckoutAction } from "../../cart/actions";

interface Props {
  readonly params: Promise<{ locale: string; id: string }>;
}

export const metadata = { robots: { index: false, follow: false } };

/**
 * The checkout (igs-pharma#116, Sprint 3 E2), one page in three steps: what you are ordering
 * (prices and stock held until the time shown), where to collect it (Sprints 3–4: pharmacy pickup
 * only), and who it is for, then "Place order". An order holding a medicine says that a pharmacist
 * checks it first. A lapsed checkout offers to start again; a placed one goes to its order.
 */
export default async function CheckoutPage({ params }: Props) {
  const { locale: rawLocale, id } = await params;
  const locale = cartLocale(rawLocale);
  const checkoutId = uuidOf(id);
  if (!checkoutId) notFound();
  const t = await getTranslations({ locale, namespace: "checkout" });
  const intl = INTL_LOCALE[locale];

  let checkout: CheckoutView | null = null;
  try {
    const { actor, token } = await cartActor();
    checkout = await getCheckout({ cartToken: token, checkoutId }, actor);
  } catch (error) {
    if (isDomainError(error) && error.code === "orders.checkout_not_found") notFound();
    logger.error({ event: "storefront.checkout_failed", err: error }, "storefront.checkout_failed");
  }
  if (checkout?.orderId) redirect(`/${locale}/orders/${checkout.orderId}`);

  const startAgain = (
    <form action={startCheckoutAction}>
      <input type="hidden" name="locale" value={locale} />
      <Button type="submit" className="min-h-[44px]">
        {t("startAgain")}
      </Button>
    </form>
  );
  const { address } = PHARMACY_IDENTITY;

  return (
    <StorefrontFrame locale={locale} path={`/checkout/${checkoutId}`}>
      <div className="flex flex-col gap-6">
        <h1 className="font-display text-3xl font-medium text-[var(--color-primary)]">
          {t("title")}
        </h1>
        {!checkout ? (
          <Alert variant="error" title={t("unavailable")} />
        ) : checkout.status === "cancelled" ? (
          <Alert variant="info" title={t("cancelled")} data-testid="checkout-cancelled">
            <Link href={`/${locale}/cart`}>{t("backToCart")}</Link>
          </Alert>
        ) : checkout.expired ? (
          <div className="flex flex-col items-start gap-3" data-testid="checkout-expired">
            <Alert variant="info" title={t("expired")} />
            {startAgain}
          </div>
        ) : (
          <>
            <section aria-labelledby="step-review" className="flex flex-col gap-3">
              <h2 id="step-review" className="font-display text-xl font-semibold">
                {t("stepReview")}
              </h2>
              <ul className="flex flex-col divide-y divide-[var(--color-border)]">
                {checkout.lines.map((line) => (
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
                <Price cents={checkout.totalCents} locale={intl} vatLabel={t("vatIncluded")} />
              </p>
              <p className="text-sm text-[var(--color-text-subtle)]" data-testid="hold-until">
                {t("heldUntil", { time: brusselsTime(checkout.expiresAt, intl) })}
              </p>
              {checkout.needsReview ? (
                // amber as background and border only, never as text (#112)
                <div
                  role="note"
                  data-testid="pharmacist-review-notice"
                  className="rounded-[var(--radius-md)] border-l-4 border-[var(--color-accent)] bg-[var(--color-accent-subtle)] p-4 text-[var(--color-text)]"
                >
                  {t("pharmacistReview")}
                </div>
              ) : null}
              <Link href={`/${locale}/cart`}>{t("changeCart")}</Link>
            </section>

            <section aria-labelledby="step-pickup" className="flex flex-col gap-2">
              <h2 id="step-pickup" className="font-display text-xl font-semibold">
                {t("stepPickup")}
              </h2>
              <p>{t("pickupOnly")}</p>
              <address className="not-italic" data-testid="pickup-address">
                {PHARMACY_IDENTITY.name}
                <br />
                {address.street}
                <br />
                {address.postalCode} {address.city}
              </address>
              <p className="text-sm text-[var(--color-text-subtle)]">
                {t("openingHours", { hours: PHARMACY_IDENTITY.openingHours })}
              </p>
              {PHARMACY_IDENTITY.isPlaceholder ? (
                // the same marker as the footer's identity block, until the real details arrive
                <p className="text-sm font-semibold">{t("placeholderNote")}</p>
              ) : null}
            </section>

            <section aria-labelledby="step-contact" className="flex flex-col gap-3">
              <h2 id="step-contact" className="font-display text-xl font-semibold">
                {t("stepContact")}
              </h2>
              <CheckoutForm locale={locale} checkoutId={checkout.checkoutId} />
            </section>
          </>
        )}
      </div>
    </StorefrontFrame>
  );
}
