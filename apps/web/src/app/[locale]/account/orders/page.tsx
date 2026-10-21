import { isFreshSession } from "@igs/auth";
import { type OwnOrderPage, listOwnOrders } from "@igs/module-orders";
import { logger } from "@igs/observability/logger";
import { Alert, Link, Price } from "@igs/ui";
import { getTranslations } from "next-intl/server";

import { AccountShell } from "../../../../components/account/account-shell";
import { brusselsDate, statusMessageKey } from "../../../../lib/checkout-area";
import { accountLocale, accountMetadata } from "../../../../server/account";
import { cartLocale } from "../../../../server/cart";
import { requireCustomer } from "../../../../server/customer";
import { INTL_LOCALE } from "../../../../server/storefront";

interface Props {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<{ page?: string | string[] }>;
}

const PAGE_SIZE = 20;

export async function generateMetadata({ params }: Props) {
  return accountMetadata((await params).locale, "navOrders");
}

/** My orders: a list of the customer's orders. Needs a sign-in at most ten minutes old (D-044). */
export default async function AccountOrdersPage({ params, searchParams }: Props) {
  const locale = accountLocale((await params).locale);
  cartLocale(locale);
  const session = await requireCustomer(locale, "/account/orders");
  const t = await getTranslations({ locale, namespace: "account" });
  const tOrder = await getTranslations({ locale, namespace: "order" });
  const intl = INTL_LOCALE[locale];
  const pageParam = (await searchParams).page;
  const pageText = Array.isArray(pageParam) ? pageParam[0] : pageParam;
  const page = pageText && /^[0-9]{1,4}$/.test(pageText) ? Math.max(1, Number(pageText)) : 1;

  if (!isFreshSession(session)) {
    return (
      <AccountShell locale={locale} section="orders" title={t("navOrders")}>
        <Alert variant="info" title={t("freshNeededTitle")} data-testid="orders-fresh-needed">
          <p>{t("ordersFreshBody")}</p>
          <Link
            href={`/${locale}/account/sign-in?next=${encodeURIComponent("/account/orders")}`}
            className="inline-flex min-h-[44px] items-center"
          >
            {t("signInAgain")}
          </Link>
        </Alert>
      </AccountShell>
    );
  }

  let result: OwnOrderPage | null = null;
  try {
    result = await listOwnOrders({ page, pageSize: PAGE_SIZE }, session.actor);
  } catch (error) {
    logger.error(
      { event: "storefront.own_orders_failed", err: error },
      "storefront.own_orders_failed",
    );
  }
  const pages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;

  return (
    <AccountShell locale={locale} section="orders" title={t("navOrders")} intro={t("ordersIntro")}>
      {!result ? (
        <Alert variant="error" title={t("ordersUnavailable")} />
      ) : result.items.length === 0 ? (
        <p data-testid="orders-empty">{t("ordersEmpty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left" data-testid="orders-table">
            <thead>
              <tr className="border-b border-[var(--color-border-strong)]">
                <th scope="col" className="py-2 pr-4 font-semibold">
                  {t("ordersColReference")}
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  {t("ordersColDate")}
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  {t("ordersColStatus")}
                </th>
                <th scope="col" className="py-2 text-right font-semibold">
                  {t("ordersColTotal")}
                </th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((order) => (
                <tr key={order.orderId} className="border-b border-[var(--color-border)]">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/${locale}/orders/${order.orderId}`}
                      className="inline-flex min-h-[44px] items-center tabular-nums"
                    >
                      {order.reference}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{brusselsDate(order.createdAt, intl)}</td>
                  <td className="py-2 pr-4">{tOrder(statusMessageKey(order.status))}</td>
                  <td className="py-2 text-right">
                    <Price cents={order.totalCents} locale={intl} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result && pages > 1 ? (
        <nav aria-label={t("ordersPages")} className="flex gap-4">
          {result.page > 1 ? (
            <Link href={`/${locale}/account/orders?page=${result.page - 1}`}>
              {t("ordersPrevious")}
            </Link>
          ) : null}
          {result.page < pages ? (
            <Link href={`/${locale}/account/orders?page=${result.page + 1}`}>
              {t("ordersNext")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </AccountShell>
  );
}
