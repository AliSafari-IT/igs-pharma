import { Alert, Link, Stack } from "@igs/ui";
import { getTranslations } from "next-intl/server";

import { AccountPage } from "../../../../components/account/account-page";
import { StorefrontFrame } from "../../../../components/storefront-frame";
import { type SearchParams, verifyOutcome } from "../../../../lib/account-forms";
import { accountLocale, accountMetadata } from "../../../../server/account";

interface Props {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<SearchParams>;
}

export async function generateMetadata({ params }: Props) {
  return accountMetadata((await params).locale, "verifyTitle");
}

/**
 * Where the e-mail confirmation link lands (igs-pharma#115, D-044), after Better Auth has checked
 * it: confirmed, or an expired or used link. Signing in with an unconfirmed address sends a new
 * link, so that is the way on from a bad one. Nothing here signs anyone in.
 */
export default async function VerifyEmailPage({ params, searchParams }: Props) {
  const locale = accountLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "account" });
  const outcome = verifyOutcome(await searchParams);
  return (
    <StorefrontFrame locale={locale} path="/account/verify-email">
      <AccountPage title={t("verifyTitle")}>
        <Stack gap={4}>
          {outcome === "confirmed" ? (
            <Alert
              variant="success"
              title={t("verifyConfirmedTitle")}
              data-testid="verify-confirmed"
            >
              {t("verifyConfirmedBody")}
            </Alert>
          ) : null}
          {outcome === "invalid" ? (
            <Alert variant="error" title={t("verifyInvalidTitle")} data-testid="verify-invalid">
              {t("verifyInvalidBody")}
            </Alert>
          ) : null}
          {outcome === "pending" ? (
            <Alert variant="info" title={t("checkInboxTitle")} data-testid="verify-pending">
              {t("verifyPendingBody")}
            </Alert>
          ) : null}
          <p>
            <Link
              href={`/${locale}/account/sign-in`}
              className="inline-flex min-h-[44px] items-center"
            >
              {t("goToSignIn")}
            </Link>
          </p>
        </Stack>
      </AccountPage>
    </StorefrontFrame>
  );
}
