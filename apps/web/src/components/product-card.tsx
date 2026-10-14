import type { ContentLocale, StorefrontProductItem } from "@igs/module-catalog";
import type { StorefrontPrice } from "@igs/module-pricing";
import { Badge, Link, Price, ProductImagePlaceholder } from "@igs/ui";
import { getTranslations } from "next-intl/server";

import { INTL_LOCALE } from "../server/storefront";

/** `600` → "6 %" (nl) or "6 %" (fr), by `Intl`, never by hand. */
export const formatRate = (rateBp: number, locale: ContentLocale): string =>
  new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(rateBp / 10_000);

interface PriceLineProps {
  readonly locale: ContentLocale;
  readonly price: StorefrontPrice | undefined;
}

/** The price including VAT with its "incl. 6 % VAT" label, or "price to follow". */
export async function PriceLine({ locale, price }: PriceLineProps) {
  const t = await getTranslations({ locale, namespace: "storefront" });
  if (!price) return <span className="text-[var(--color-text-subtle)]">{t("priceUnknown")}</span>;
  return (
    <Price
      cents={price.amountCents}
      locale={INTL_LOCALE[locale]}
      vatLabel={t("vatIncluded", { rate: formatRate(price.vatRateBp, locale) })}
    />
  );
}

/** In or out of stock, never how many. */
export async function StockBadge({
  locale,
  inStock,
}: { readonly locale: ContentLocale; readonly inStock: boolean }) {
  const t = await getTranslations({ locale, namespace: "storefront" });
  return (
    <Badge variant={inStock ? "success" : "neutral"}>
      {inStock ? t("inStock") : t("outOfStock")}
    </Badge>
  );
}

interface CardProps {
  readonly locale: ContentLocale;
  readonly item: StorefrontProductItem;
  readonly price: StorefrontPrice | undefined;
  readonly inStock: boolean;
}

/** One product in a list: name (the link), brand, short description, price and availability. */
export async function ProductCard({ locale, item, price, inStock }: CardProps) {
  return (
    <li>
      <article className="flex h-full flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
        <ProductImagePlaceholder />
        <h3 className="font-display text-lg font-semibold">
          <Link href={`/${locale}/p/${item.cnk}`}>{item.name}</Link>
        </h3>
        {item.brandName ? (
          <p className="text-sm text-[var(--color-text-subtle)]">{item.brandName}</p>
        ) : null}
        {item.shortDescription ? <p>{item.shortDescription}</p> : null}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
          <PriceLine locale={locale} price={price} />
          <StockBadge locale={locale} inStock={inStock} />
        </div>
      </article>
    </li>
  );
}
