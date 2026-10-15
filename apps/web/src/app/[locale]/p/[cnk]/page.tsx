import { isDomainError } from "@igs/kernel";
import { type StorefrontProductView, getStorefrontProduct } from "@igs/module-storefront";
import { logger } from "@igs/observability/logger";
import { Alert, Breadcrumbs, Button, ProductImagePlaceholder } from "@igs/ui";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { PriceLine, StockBadge } from "../../../../components/product-card";
import { StorefrontFrame } from "../../../../components/storefront-frame";
import { ensureKernelConfigured } from "../../../../server/kernel";
import { STOREFRONT_ACTOR, localeOf } from "../../../../server/storefront";

interface Props {
  readonly params: Promise<{ locale: string; cnk: string }>;
}

/**
 * One product (igs-pharma#104): breadcrumb, name, brand, CNK, price with VAT, availability, the
 * texts and warnings, and a disabled cart button until ordering opens. A medicine gets the neutral
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
            <ProductImagePlaceholder />
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
              {product.isMedicine ? (
                <p
                  role="note"
                  data-testid="medicine-notice"
                  className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
                >
                  {t("medicineNotice")}
                </p>
              ) : null}
              <div className="flex flex-col gap-1">
                <div>
                  <Button disabled className="min-h-[44px]">
                    {t("addToCart")}
                  </Button>
                </div>
                <p className="text-sm text-[var(--color-text-subtle)]">{t("addToCartSoon")}</p>
              </div>
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
