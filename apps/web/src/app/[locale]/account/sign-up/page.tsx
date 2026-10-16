import { CUSTOMER_PASSWORD_MIN } from "@igs/auth";
import { getTranslations } from "next-intl/server";

import { AccountPage } from "../../../../components/account/account-page";
import { SignUpForm } from "../../../../components/account/sign-up-form";
import { StorefrontFrame } from "../../../../components/storefront-frame";
import { accountLocale, accountMetadata } from "../../../../server/account";

interface Props {
  readonly params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props) {
  return accountMetadata((await params).locale, "signUpTitle");
}

/** Create a customer account (igs-pharma#115, D-044); 404 while the feature flag is off. */
export default async function SignUpPage({ params }: Props) {
  const locale = accountLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "account" });
  return (
    <StorefrontFrame locale={locale} path="/account/sign-up">
      <AccountPage title={t("signUpTitle")} intro={t("signUpIntro")}>
        <SignUpForm locale={locale} passwordMin={CUSTOMER_PASSWORD_MIN} />
      </AccountPage>
    </StorefrontFrame>
  );
}
