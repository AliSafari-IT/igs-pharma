import { getOwnAccount } from "@igs/module-identity";
import { Link } from "@igs/ui";
import { getTranslations } from "next-intl/server";

import { AccountShell } from "../../../components/account/account-shell";
import { accountLocale, accountMetadata } from "../../../server/account";
import { requireCustomer } from "../../../server/customer";

interface Props {
  readonly params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props) {
  return accountMetadata((await params).locale, "navOverview");
}

/** My account (igs-pharma#115 PR C, D-044): who is signed in, and the way to their orders. */
export default async function AccountOverviewPage({ params }: Props) {
  const locale = accountLocale((await params).locale);
  const session = await requireCustomer(locale, "/account");
  const t = await getTranslations({ locale, namespace: "account" });
  const account = await getOwnAccount({}, session.actor);
  return (
    <AccountShell
      locale={locale}
      section="overview"
      title={t("overviewGreeting", { name: account.name })}
      intro={t("overviewSignedInAs", { email: account.email })}
    >
      <section aria-labelledby="orders-heading" className="flex flex-col gap-2">
        <h2 id="orders-heading" className="font-display text-xl font-medium">
          {t("ordersTitle")}
        </h2>
        <Link
          href={`/${locale}/account/orders`}
          data-testid="orders-link"
          className="inline-flex min-h-[44px] items-center self-start"
        >
          {t("ordersViewAll")}
        </Link>
      </section>
    </AccountShell>
  );
}
