import { isDomainError } from "@igs/kernel";
import { type StorefrontProduct, getStorefrontProduct } from "@igs/module-catalog";
import { logger } from "@igs/observability/logger";
import { Alert, Button, Link } from "@igs/ui";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { PriceLine, StockBadge } from "../../../../components/product-card";
import { StorefrontFrame } from "../../../../components/storefront-frame";
import { ensureKernelConfigured } from "../../../../server/kernel";
import { STOREFRONT_ACTOR, localeOf, priceAndStock } from "../../../../server/storefront";

interface Props {
  readonly params: Promise<{ locale: string; cnk: string }>;
}

/** One active product: texts, warnings, price with VAT, availability and a disabled cart button. */
export default async function ProductPage({ params }: Props) {
  const { locale: rawLocale, cnk } = await params;
  const locale = localeOf(rawLocale);
  if (!locale || !/^[0-9]{7}$/.test(cnk)) notFound();
  const t = await getTranslations({ locale, namespace: "storefront" });

  let product: StorefrontProduct | null = null;
  let stock: Awaited<ReturnType<typeof priceAndStock>> | null = null;
  try {
    await ensureKernelConfigured();
    product = await getStorefrontProduct({ cnk, locale }, STOREFRONT_ACTOR);
    stock = await priceAndStock([product.id]);
  } catch (error) {
    if (isDomainError(error) && error.code === "catalog.product_not_found") notFound();
    logger.error({ event: "storefront.product_failed", err: error }, "storefront.product_failed");
  }

  return (
    <StorefrontFrame locale={locale} path={`/p/${cnk}`}>
      {!product || !stock ? (
        <Alert variant="error" title={t("unavailable")} />
      ) : (
        <article className="flex flex-col gap-4">
          {product.categories[0] ? (
            <Link href={`/${locale}/c/${product.categories[0].slug}`} variant="subtle">
              {t("backTo", { name: product.categories[0].name })}
            </Link>
          ) : null}
          <h1 className="font-display text-3xl font-medium text-[var(--color-primary)]">
            {product.name}
          </h1>
          {product.contentLocale !== locale ? (
            <p lang={product.contentLocale} className="text-sm text-[var(--color-text-subtle)]">
              {t("untranslated")}
            </p>
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
            <PriceLine locale={locale} price={stock.prices.get(product.id)} />
            <StockBadge locale={locale} inStock={stock.inStock.get(product.id) ?? false} />
          </div>
          <div className="flex flex-col gap-1">
            <div>
              <Button disabled>{t("addToCart")}</Button>
            </div>
            <p className="text-sm text-[var(--color-text-subtle)]">{t("addToCartSoon")}</p>
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
