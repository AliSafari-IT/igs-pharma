import type { ContentLocale } from "@igs/module-catalog";
import type {
  AvailabilityStatus,
  StorefrontListItem,
  StorefrontPriceView,
} from "@igs/module-storefront";
import { Badge, Link, Price } from "@igs/ui";
import { getTranslations } from "next-intl/server";

import { INTL_LOCALE } from "../server/storefront";
import { ProductIllustration } from "./product-illustration";

/** `600` → "6 %" (nl) or "6 %" (fr), by `Intl`, never by hand. */
export const formatRate = (rateBp: number, locale: ContentLocale): string =>
  new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(rateBp / 10_000);

/** The price including VAT with its "incl. 6 % VAT" label. */
export async function PriceLine({
  locale,
  price,
}: { readonly locale: ContentLocale; readonly price: StorefrontPriceView }) {
  const t = await getTranslations({ locale, namespace: "storefront" });
  return (
    <Price
      cents={price.amountCents}
      locale={INTL_LOCALE[locale]}
      vatLabel={t("vatIncluded", { rate: formatRate(price.vatRateBp, locale) })}
    />
  );
}

const STATUS_VARIANT = { available: "success", low: "amber", out: "neutral" } as const;

/** Available, few left, or out of stock; never how many. The words carry the meaning, not the colour. */
export async function StockBadge({
  locale,
  status,
}: { readonly locale: ContentLocale; readonly status: AvailabilityStatus }) {
  const t = await getTranslations({ locale, namespace: "storefront" });
  const label = { available: t("inStock"), low: t("lowStock"), out: t("outOfStock") }[status];
  return <Badge variant={STATUS_VARIANT[status]}>{label}</Badge>;
}

interface CardProps {
  readonly locale: ContentLocale;
  readonly item: StorefrontListItem;
}

/** One product in a list: name (the link), brand, short description, price and availability. */
export async function ProductCard({ locale, item }: CardProps) {
  return (
    <li>
      <article className="flex h-full flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
        <ProductIllustration />
        <h3 lang={item.contentLocale} className="font-display text-lg font-semibold">
          <Link href={`/${locale}/p/${item.cnk}`}>{item.name}</Link>
        </h3>
        {item.brandName ? (
          <p className="text-sm text-[var(--color-text-subtle)]">{item.brandName}</p>
        ) : null}
        {item.shortDescription ? <p lang={item.contentLocale}>{item.shortDescription}</p> : null}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
          <PriceLine locale={locale} price={item.price} />
          <StockBadge locale={locale} status={item.status} />
        </div>
      </article>
    </li>
  );
}
