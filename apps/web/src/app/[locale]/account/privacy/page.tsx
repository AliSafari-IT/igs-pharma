import { type ConsentPurpose, type OwnDsr, getOwnConsents, listOwnDsr } from "@igs/module-privacy";
import { Alert, Button, Stack } from "@igs/ui";
import { getTranslations } from "next-intl/server";

import { AccountShell } from "../../../../components/account/account-shell";
import { ResultAlert } from "../../../../components/account/result-alert";
import { resultOf } from "../../../../lib/account-area";
import { accountLocale, accountMetadata } from "../../../../server/account";
import { requireCustomer } from "../../../../server/customer";
import { requestData, saveConsent } from "../actions";

interface Props {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const PURPOSE_LABEL: Readonly<Record<ConsentPurpose, string>> = {
  marketing_email: "consentMarketing",
  analytics_cookies: "consentAnalytics",
};

const STATUS_LABEL: Readonly<Record<OwnDsr["status"], string>> = {
  received: "statusReceived",
  in_progress: "statusInProgress",
  completed: "statusCompleted",
  rejected: "statusRejected",
};

export async function generateMetadata({ params }: Props) {
  return accountMetadata((await params).locale, "privacyTitle");
}

/**
 * My privacy (igs-pharma#115 PR C, D-044): consent choices, and a request for a copy of the data or
 * its erasure. Erasure is a request the pharmacy handles by hand (some records are kept by law).
 * The wording is a placeholder until counsel supplies the real text.
 */
export default async function PrivacyPage({ params, searchParams }: Props) {
  const locale = accountLocale((await params).locale);
  const session = await requireCustomer(locale, "/account/privacy");
  const t = await getTranslations({ locale, namespace: "account" });
  const [consents, requests] = await Promise.all([
    getOwnConsents({}, session.actor),
    listOwnDsr({}, session.actor),
  ]);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Brussels" });
  const hidden = <input type="hidden" name="locale" value={locale} />;

  return (
    <AccountShell
      locale={locale}
      section="privacy"
      title={t("privacyTitle")}
      intro={t("privacyIntro")}
    >
      <ResultAlert locale={locale} result={resultOf(await searchParams)} />

      <section aria-labelledby="consents-heading" className="flex flex-col gap-3">
        <h2 id="consents-heading" className="font-display text-xl font-medium">
          {t("consentsTitle")}
        </h2>
        <ul className="flex flex-col gap-3">
          {consents.purposes.map(({ purpose, current }) => {
            const given = current?.granted === true;
            return (
              <li
                key={purpose}
                data-testid={`consent-${purpose}`}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <span>
                  <span className="font-medium">{t(PURPOSE_LABEL[purpose])}</span>
                  {": "}
                  <span>{t(given ? "consentGiven" : "consentNotGiven")}</span>
                </span>
                <form action={saveConsent}>
                  {hidden}
                  <input type="hidden" name="purpose" value={purpose} />
                  <input type="hidden" name="granted" value={given ? "false" : "true"} />
                  <Button type="submit" variant="secondary">
                    {t(given ? "consentWithdraw" : "consentGive")}
                  </Button>
                </form>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="data-heading" className="flex flex-col gap-3">
        <h2 id="data-heading" className="font-display text-xl font-medium">
          {t("dataTitle")}
        </h2>
        <p>{t("dataIntro")}</p>
        <p className="text-sm text-[var(--color-text-subtle)]">{t("erasureNote")}</p>
        <Stack gap={3} align="start">
          {(
            [
              ["access", "requestAccess", "secondary"],
              ["erasure", "requestErasure", "danger"],
            ] as const
          ).map(([type, label, variant]) => (
            <form action={requestData} key={type}>
              {hidden}
              <input type="hidden" name="type" value={type} />
              <Button type="submit" variant={variant} data-testid={`request-${type}`}>
                {t(label)}
              </Button>
            </form>
          ))}
        </Stack>
      </section>

      <section aria-labelledby="requests-heading" className="flex flex-col gap-3">
        <h2 id="requests-heading" className="font-display text-xl font-medium">
          {t("requestsTitle")}
        </h2>
        {requests.length === 0 ? (
          <p>{t("noRequests")}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="dsr-list">
            {requests.map((request) => (
              <li key={request.id}>
                <span className="font-medium">
                  {t(request.type === "erasure" ? "typeErasure" : "typeAccess")}
                </span>
                {" · "}
                {t(STATUS_LABEL[request.status])}
                {request.closedAt ? null : ` · ${t("dueOn", { date: date.format(request.dueAt) })}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Alert variant="info" title={t("legalPlaceholder")} />
    </AccountShell>
  );
}
