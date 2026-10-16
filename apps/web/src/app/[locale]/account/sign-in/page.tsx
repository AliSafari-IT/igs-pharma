import { getTranslations } from "next-intl/server";

import { AccountPage } from "../../../../components/account/account-page";
import { SignInForm } from "../../../../components/account/sign-in-form";
import { StorefrontFrame } from "../../../../components/storefront-frame";
import { accountLocale, accountMetadata } from "../../../../server/account";

interface Props {
  readonly params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props) {
  return accountMetadata((await params).locale, "signInTitle");
}

/** Customer sign-in (igs-pharma#115, D-044); 404 while the feature flag is off. */
export default async function SignInPage({ params }: Props) {
  const locale = accountLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "account" });
  return (
    <StorefrontFrame locale={locale} path="/account/sign-in">
      <AccountPage title={t("signInTitle")}>
        <SignInForm locale={locale} />
      </AccountPage>
    </StorefrontFrame>
  );
}
