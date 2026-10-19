import { CUSTOMER_PASSWORD_MIN, isFreshSession } from "@igs/auth";
import { getTranslations } from "next-intl/server";

import { AccountShell } from "../../../../components/account/account-shell";
import { SecurityPanel } from "../../../../components/account/security-panel";
import { accountLocale, accountMetadata } from "../../../../server/account";
import { requireCustomer } from "../../../../server/customer";

interface Props {
  readonly params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props) {
  return accountMetadata((await params).locale, "securityTitle");
}

/**
 * Security (igs-pharma#115 PR C, D-044): change the password and sign out elsewhere. Changing the
 * password needs a sign-in at most ten minutes old; an older session is asked to sign in again first.
 */
export default async function SecurityPage({ params }: Props) {
  const locale = accountLocale((await params).locale);
  const session = await requireCustomer(locale, "/account/security");
  const t = await getTranslations({ locale, namespace: "account" });
  return (
    <AccountShell
      locale={locale}
      section="security"
      title={t("securityTitle")}
      intro={t("securityIntro")}
    >
      <SecurityPanel
        locale={locale}
        fresh={isFreshSession(session)}
        passwordMin={CUSTOMER_PASSWORD_MIN}
      />
    </AccountShell>
  );
}
