import { getFeatureFlags } from "@igs/config/feature-flags";
import { logger } from "@igs/observability/logger";
import { Alert, Button, Link, Price } from "@igs/ui";
import { getTranslations } from "next-intl/server";

import { StorefrontFrame } from "../../../../components/storefront-frame";
import { LIST_LINK_PARAM } from "../../../../list-link";
import { cartLocale } from "../../../../server/cart";
import { type ListEntry, checkListToken, loadListEntries } from "../../../../server/list-link";
import { INTL_LOCALE, localeOf } from "../../../../server/storefront";
import { addListToCart } from "../actions";

interface Props {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props) {
  const robots = { index: false, follow: false } as const;
  const locale = localeOf((await params).locale);
  if (!locale || !getFeatureFlags().cart) return { robots };
  const t = await getTranslations({ locale, namespace: "cart" });
  return { title: `${t("fromListTitle")} · IGS-Pharma`, robots };
}

/**
 * "Order my list" (igs-pharma#218): the page the Android app's signed link opens. It shows the list's
 * products as the shop sells them today and offers ONE button that adds them to the cart. Opening it
 * changes nothing: a link preview, a prefetch or a crawler never fills anybody's cart. An expired or
 * forged link says so and what to do. Exists only while the cart is on (404 otherwise).
 */
export default async function FromListPage({ params, searchParams }: Props) {
  const locale = cartLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "cart" });
  const raw = (await searchParams)[LIST_LINK_PARAM];
  const token = typeof raw === "string" ? raw : null;
  const check = checkListToken(token);

  let entries: ListEntry[] | null = null;
  if (check.ok) {
    try {
      entries = await loadListEntries(check.cnks, locale);
    } catch (error) {
      logger.error(
        { event: "storefront.list_link_failed", err: error },
        "storefront.list_link_failed",
      );
    }
  }
  // what the button can add: still sold and in stock (an out-of-stock product can't be added anywhere)
  const available =
    entries?.filter((entry) => entry.product && entry.product.status !== "out") ?? [];

  return (
    <StorefrontFrame locale={locale} path="/cart">
      <div className="flex flex-col gap-6">
        <h1 className="font-display text-3xl font-medium text-[var(--color-primary)]">
          {t("fromListTitle")}
        </h1>
        {!check.ok ? (
          <Alert
            variant="error"
            role="alert"
            title={t(check.reason === "expired" ? "fromListExpired" : "fromListInvalid")}
            data-testid={`from-list-${check.reason}`}
          >
            {t("fromListAgain")}
          </Alert>
        ) : !entries ? (
          <Alert variant="error" title={t("unavailable")} />
        ) : (
          <>
            <p>{t("fromListIntro", { count: entries.length })}</p>
            <ul
              className="flex flex-col divide-y divide-[var(--color-border)]"
              data-testid="from-list-lines"
            >
              {entries.map(({ cnk, product }) => (
                <li key={cnk} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                  {product ? (
                    <>
                      <Link href={`/${locale}/p/${product.cnk}`}>{product.name}</Link>
                      <span className="flex items-baseline gap-3">
                        {product.status === "out" ? (
                          <span className="text-sm text-[var(--color-text-subtle)]">
                            {t("fromListOut")}
                          </span>
                        ) : null}
                        <Price
                          cents={product.price.amountCents}
                          locale={INTL_LOCALE[locale]}
                          vatLabel={t("each")}
                        />
                      </span>
                    </>
                  ) : (
                    <span className="text-[var(--color-text-subtle)]">
                      {t("fromListGone", { cnk })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {available.length > 0 ? (
              <form action={addListToCart} className="flex flex-wrap items-center gap-4">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name={LIST_LINK_PARAM} value={token ?? ""} />
                <Button type="submit" data-testid="from-list-add">
                  {t("fromListAdd")}
                </Button>
                <Link href={`/${locale}/cart`}>{t("fromListSkip")}</Link>
              </form>
            ) : (
              <Alert variant="error" title={t("fromListNone")} />
            )}
            <p className="text-sm text-[var(--color-text-subtle)]">{t("fromListNote")}</p>
          </>
        )}
      </div>
    </StorefrontFrame>
  );
}
