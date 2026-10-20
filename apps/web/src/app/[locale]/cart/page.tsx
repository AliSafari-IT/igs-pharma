import { getFeatureFlags } from "@igs/config/feature-flags";
import { type CartView, getCart } from "@igs/module-orders";
import { logger } from "@igs/observability/logger";
import { Alert, Button, EmptyState, Label, Link, Price, Select } from "@igs/ui";
import { getTranslations } from "next-intl/server";

import { StorefrontFrame } from "../../../components/storefront-frame";
import { isSuccessResult, resultMessageKey, resultOf } from "../../../lib/cart-area";
import { cartActor, cartLocale } from "../../../server/cart";
import { INTL_LOCALE, localeOf } from "../../../server/storefront";
import { updateCartLine } from "./actions";

interface Props {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props) {
  const robots = { index: false, follow: false } as const;
  const locale = localeOf((await params).locale);
  if (!locale || !getFeatureFlags().cart) return { robots };
  const t = await getTranslations({ locale, namespace: "cart" });
  return { title: `${t("title")} · IGS-Pharma`, robots };
}

/**
 * The cart (igs-pharma#116): its lines with today's price, a quantity field per line (up to the
 * per-order limit) and a remove button, an indicative total, and the way to checkout once it opens.
 * Every form posts to a Server Action and comes back here with a `?result=`, so it works without
 * JavaScript. A line whose product can no longer be bought stays, explained, until it is removed.
 */
export default async function CartPage({ params, searchParams }: Props) {
  const locale = cartLocale((await params).locale);
  const result = resultOf(await searchParams);
  const t = await getTranslations({ locale, namespace: "cart" });
  const intl = INTL_LOCALE[locale];

  let cart: CartView | null = null;
  try {
    const { actor, token } = await cartActor();
    cart = await getCart({ cartToken: token, locale }, actor);
  } catch (error) {
    logger.error({ event: "storefront.cart_failed", err: error }, "storefront.cart_failed");
  }

  return (
    <StorefrontFrame locale={locale} path="/cart">
      <div className="flex flex-col gap-6">
        <h1 className="font-display text-3xl font-medium text-[var(--color-primary)]">
          {t("title")}
        </h1>
        {result ? (
          <Alert
            variant={isSuccessResult(result) ? "success" : "error"}
            role={isSuccessResult(result) ? "status" : "alert"}
            title={t(resultMessageKey(result))}
            data-testid={`cart-result-${result}`}
          />
        ) : null}
        {!cart ? (
          <Alert variant="error" title={t("unavailable")} />
        ) : cart.lines.length === 0 ? (
          <EmptyState title={t("empty")} data-testid="cart-empty">
            <Link href={`/${locale}`}>{t("continueShopping")}</Link>
          </EmptyState>
        ) : (
          <>
            <ul
              className="flex flex-col divide-y divide-[var(--color-border)]"
              data-testid="cart-lines"
            >
              {cart.lines.map((line) => {
                const fieldId = `qty-${line.productId}`;
                return (
                  <li
                    key={line.productId}
                    className="flex flex-col gap-3 py-4 sm:flex-row sm:items-end sm:justify-between"
                  >
                    <div className="flex flex-col gap-1">
                      {line.sellable && line.cnk ? (
                        <Link href={`/${locale}/p/${line.cnk}`} className="font-semibold">
                          {line.name}
                        </Link>
                      ) : (
                        <p className="font-semibold">{t("noLongerAvailable")}</p>
                      )}
                      {line.unitPriceCents !== null ? (
                        <Price cents={line.unitPriceCents} locale={intl} vatLabel={t("each")} />
                      ) : line.sellable ? (
                        <p className="text-sm text-[var(--color-text-subtle)]">
                          {t("priceUnknown")}
                        </p>
                      ) : null}
                    </div>
                    <form action={updateCartLine} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="productId" value={line.productId} />
                      {line.sellable && line.maxQuantity !== null ? (
                        <>
                          <div className="flex flex-col gap-1">
                            <Label htmlFor={fieldId}>{t("quantity")}</Label>
                            <Select
                              id={fieldId}
                              name="quantity"
                              defaultValue={String(Math.min(line.quantity, line.maxQuantity))}
                              className="w-24"
                            >
                              {Array.from({ length: line.maxQuantity }, (_, i) => i + 1).map(
                                (n) => (
                                  <option key={n} value={n}>
                                    {n}
                                  </option>
                                ),
                              )}
                            </Select>
                          </div>
                          <Button type="submit" variant="secondary" className="min-h-[44px]">
                            {t("update")}
                          </Button>
                        </>
                      ) : null}
                      <Button
                        type="submit"
                        name="remove"
                        value="1"
                        variant="ghost"
                        className="min-h-[44px]"
                        aria-label={t("removeNamed", { name: line.name ?? t("noLongerAvailable") })}
                      >
                        {t("remove")}
                      </Button>
                    </form>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-col items-start gap-3 border-t border-[var(--color-border)] pt-4">
              <p className="flex items-baseline gap-2">
                <span className="font-semibold">{t("total")}</span>
                <Price cents={cart.totalCents} locale={intl} vatLabel={t("vatIncluded")} />
              </p>
              <p className="text-sm text-[var(--color-text-subtle)]">{t("totalNote")}</p>
              <Button disabled className="min-h-[44px]">
                {t("checkout")}
              </Button>
              <p className="text-sm text-[var(--color-text-subtle)]">{t("checkoutSoon")}</p>
            </div>
          </>
        )}
      </div>
    </StorefrontFrame>
  );
}
