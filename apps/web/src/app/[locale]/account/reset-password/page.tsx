import { CUSTOMER_PASSWORD_MIN } from "@igs/auth";
import { Alert, Link, Stack } from "@igs/ui";
import { getTranslations } from "next-intl/server";

import { AccountPage } from "../../../../components/account/account-page";
import { ResetPasswordForm } from "../../../../components/account/reset-password-form";
import { StorefrontFrame } from "../../../../components/storefront-frame";
import { type SearchParams, resetToken } from "../../../../lib/account-forms";
import { accountLocale, accountMetadata } from "../../../../server/account";

interface Props {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<SearchParams>;
}

export async function generateMetadata({ params }: Props) {
  return accountMetadata((await params).locale, "resetTitle");
}

/**
 * Choose a new password (igs-pharma#115, D-044). The mailed link passes through Better Auth, which
 * lands here with `?token=…`, or `?error=…` when it already knows the link is bad. The token stays
 * out of the language links (`path`), so it is not copied into other URLs on the page.
 */
export default async function ResetPasswordPage({ params, searchParams }: Props) {
  const locale = accountLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "account" });
  const token = resetToken(await searchParams);
  return (
    <StorefrontFrame locale={locale} path="/account/reset-password">
      <AccountPage title={t("resetTitle")}>
        {token ? (
          <ResetPasswordForm locale={locale} token={token} passwordMin={CUSTOMER_PASSWORD_MIN} />
        ) : (
          <Stack gap={4}>
            <Alert variant="error" title={t("resetLinkInvalid")} data-testid="reset-link-invalid" />
            <p>
              <Link
                href={`/${locale}/account/forgot-password`}
                className="inline-flex min-h-[44px] items-center"
              >
                {t("requestNewLink")}
              </Link>
            </p>
          </Stack>
        )}
      </AccountPage>
    </StorefrontFrame>
  );
}
