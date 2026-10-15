import { getTranslations } from "next-intl/server";

import { AccountPage } from "../../../../components/account/account-page";
import { ForgotPasswordForm } from "../../../../components/account/forgot-password-form";
import { StorefrontFrame } from "../../../../components/storefront-frame";
import { accountLocale, accountMetadata } from "../../../../server/account";

interface Props {
  readonly params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props) {
  return accountMetadata((await params).locale, "forgotTitle");
}

/** Ask for a password reset link (igs-pharma#115, D-044); 404 while the feature flag is off. */
export default async function ForgotPasswordPage({ params }: Props) {
  const locale = accountLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "account" });
  return (
    <StorefrontFrame locale={locale} path="/account/forgot-password">
      <AccountPage title={t("forgotTitle")} intro={t("forgotIntro")}>
        <ForgotPasswordForm locale={locale} />
      </AccountPage>
    </StorefrontFrame>
  );
}
