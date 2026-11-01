import { getFeatureFlags } from "@igs/config/feature-flags";
import { isDomainError } from "@igs/kernel";
import { getDeliveryQuote } from "@igs/module-orders";
import { type StorefrontProductView, getStorefrontProduct } from "@igs/module-storefront";
import { logger } from "@igs/observability/logger";
import { Alert, Breadcrumbs, Button, formatPrice } from "@igs/ui";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { PriceLine, StockBadge } from "../../../../components/product-card";
import { ProductIllustration } from "../../../../components/product-illustration";
import { StorefrontFrame } from "../../../../components/storefront-frame";
import { ensureKernelConfigured } from "../../../../server/kernel";
import { INTL_LOCALE, STOREFRONT_ACTOR, localeOf } from "../../../../server/storefront";
import { addToCart } from "../../cart/actions";

interface Props {
  readonly params: Promise<{ locale: string; cnk: string }>;
}

/**
 * One product (igs-pharma#104): breadcrumb, name, brand, CNK, price with VAT, availability, the
 * texts and warnings, and the cart button (disabled with a notice until the cart is switched on, #116). A medicine gets the neutral
 * "read the leaflet, ask your pharmacist" notice; the page makes no claim about what a product
 * does beyond the pharmacist-approved text.
 */
export default async function ProductPage({ params }: Props) {
  const { locale: rawLocale, cnk } = await params;
  const locale = localeOf(rawLocale);
  if (!locale || !/^[0-9]{7}$/.test(cnk)) notFound();
  const t = await getTranslations({ locale, namespace: "storefront" });

  let product: StorefrontProductView | null = null;
  try {
    await ensureKernelConfigured();
    product = await getStorefrontProduct({ cnk, locale }, STOREFRONT_ACTOR);
  } catch (error) {
    if (isDomainError(error) && error.code === "catalog.product_not_found") notFound();
    logger.error({ event: "storefront.product_failed", err: error }, "storefront.product_failed");
  }

  // what getting it costs, before the cart (igs-pharma#202): the staff's delivery price and the order
  // value from which delivery is free; `null` while home delivery is off (pickup only)
  let deliveryNote: string | null = null;
  if (product && getFeatureFlags().homeDelivery) {
    try {
      const quote = await getDeliveryQuote({ itemsTotalCents: 0 }, STOREFRONT_ACTOR);
      const intl = INTL_LOCALE[locale];
      deliveryNote =
        quote.freeFromCents === null
          ? t("deliveryNoteNever", { price: formatPrice(quote.priceCents, intl) })
          : t("deliveryNote", {
              price: formatPrice(quote.priceCents, intl),
              amount: formatPrice(quote.freeFromCents, intl),
            });
    } catch (error) {
      logger.error(
        { event: "storefront.delivery_quote_failed", err: error },
        "storefront.delivery_quote_failed",
      );
    }
  }

  return (
    <StorefrontFrame
      locale={locale}
      path={`/p/${cnk}`}
      activeSlug={product?.breadcrumb.at(-1)?.slug}
    >
      {!product ? (
        <Alert variant="error" title={t("unavailable")} />
      ) : (
        <article className="flex flex-col gap-4">
          <Breadcrumbs
            label={t("breadcrumb")}
            items={[
              { label: t("home"), href: `/${locale}` },
              ...product.breadcrumb.map((category) => ({
                label: category.name,
                href: `/${locale}/c/${category.slug}`,
              })),
              { label: product.name },
            ]}
          />
          <div className="grid gap-6 md:grid-cols-[minmax(0,16rem)_1fr]">
            {/* the root category picks the illustration: the demo icons are top-level categories */}
            <ProductIllustration slug={product.breadcrumb[0]?.slug} />
            <div className="flex flex-col gap-4">
              <h1
                lang={product.contentLocale}
                className="font-display text-3xl font-medium text-[var(--color-primary)]"
              >
                {product.name}
              </h1>
              {product.contentLocale !== locale ? (
                // the notice is in the shopper's language (t()); only the product's own text is not
                <p className="text-sm text-[var(--color-text-subtle)]">{t("untranslated")}</p>
              ) : null}
              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
                {product.brandName ? (
                  <>
                    <dt className="text-[var(--color-text-subtle)]">{t("brand")}</dt>
                    <dd>{product.brandName}</dd>
                  </>
                ) : null}
                <dt className="text-[var(--color-text-subtle)]">{t("cnk")}</dt>
                <dd>
                  <code>{product.cnk}</code>
                </dd>
              </dl>
              <div className="flex flex-wrap items-center gap-4">
                <PriceLine locale={locale} price={product.price} />
                <StockBadge locale={locale} status={product.status} />
              </div>
              {getFeatureFlags().cart ? (
                // what getting it costs, before the cart: pickup only, or pickup and home delivery
                deliveryNote ? (
                  <p
                    data-testid="delivery-cost"
                    className="text-sm text-[var(--color-text-subtle)]"
                  >
                    {deliveryNote}
                  </p>
                ) : (
                  <p data-testid="pickup-cost" className="text-sm text-[var(--color-text-subtle)]">
                    {t("pickupFree")}
                  </p>
                )
              ) : null}
              {product.isMedicine ? (
                // "ask your pharmacist" (#112): amber as background and border only, never as text
                <div
                  role="note"
                  aria-labelledby="pharmacist-heading"
                  data-testid="medicine-notice"
                  className="rounded-[var(--radius-md)] border-l-4 border-[var(--color-accent)] bg-[var(--color-accent-subtle)] p-4"
                >
                  <h2
                    id="pharmacist-heading"
                    className="font-display text-lg font-semibold text-[var(--color-text)]"
                  >
                    {t("askPharmacistHeading")}
                  </h2>
                  <p className="mt-1 text-[var(--color-text)]">{t("medicineNotice")}</p>
                </div>
              ) : null}
              {getFeatureFlags().cart ? (
                // the cart (#116): one more of it per press, the limits are checked on the server
                <form action={addToCart} className="flex flex-col gap-1">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="productId" value={product.id} />
                  <div>
                    <Button
                      type="submit"
                      disabled={product.status === "out"}
                      className="min-h-[44px]"
                      data-testid="add-to-cart"
                    >
                      {t("addToCart")}
                    </Button>
                  </div>
                  {product.status === "out" ? (
                    <p className="text-sm text-[var(--color-text-subtle)]">{t("outOfStock")}</p>
                  ) : null}
                </form>
              ) : (
                <div className="flex flex-col gap-1">
                  <div>
                    <Button disabled className="min-h-[44px]">
                      {t("addToCart")}
                    </Button>
                  </div>
                  <p className="text-sm text-[var(--color-text-subtle)]">{t("addToCartSoon")}</p>
                </div>
              )}
            </div>
          </div>
          {product.description ? (
            <section lang={product.contentLocale} aria-labelledby="description-heading">
              <h2 id="description-heading" className="font-display text-xl font-semibold">
                {t("description")}
              </h2>
              <p className="mt-1 whitespace-pre-line">{product.description}</p>
            </section>
          ) : null}
          {product.warnings ? (
            <section lang={product.contentLocale} aria-labelledby="warnings-heading">
              <h2 id="warnings-heading" className="font-display text-xl font-semibold">
                {t("warnings")}
              </h2>
              <p className="mt-1 whitespace-pre-line">{product.warnings}</p>
            </section>
          ) : null}
        </article>
      )}
    </StorefrontFrame>
  );
}
