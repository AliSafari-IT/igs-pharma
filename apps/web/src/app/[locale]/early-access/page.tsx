import {
  EARLY_ACCESS_TEXT_MAX,
  type OwnEarlyAccess,
  canAskForEarlyAccess,
  getOwnEarlyAccess,
} from "@igs/module-identity";
import { Alert, Button, Label, Textarea } from "@igs/ui";
import { getTranslations } from "next-intl/server";

import { AccountPage } from "../../../components/account/account-page";
import { SignOutButton } from "../../../components/account/sign-out-button";
import { StorefrontFrame } from "../../../components/storefront-frame";
import { PASS_PATH } from "../../../early-access";
import {
  earlyAccessResultKey,
  earlyAccessResultOf,
  isEarlyAccessSuccess,
} from "../../../lib/early-access-area";
import { accountLocale, accountMetadata } from "../../../server/account";
import { currentCustomer } from "../../../server/customer";
import { askForEarlyAccess } from "./actions";

interface Props {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props) {
  return accountMetadata((await params).locale, "earlyAccessTitle");
}

/**
 * Early access (igs-pharma#199): signed out, the way to sign in or create an account; signed in, the
 * person's own request: ask (with an optional note), see where it stands, open the shop once approved.
 * Reachable while the shop is closed (the proxy lets it through in a frame that shows nothing of the
 * shop); 404 while customer accounts are off. Plain forms, no script.
 */
export default async function EarlyAccessPage({ params, searchParams }: Props) {
  const locale = accountLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "earlyAccess" });
  const tAccount = await getTranslations({ locale, namespace: "account" });
  const result = earlyAccessResultOf(await searchParams);
  const customer = await currentCustomer();
  const state: OwnEarlyAccess | null = customer
    ? await getOwnEarlyAccess({}, customer.actor)
    : null;
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Brussels",
  });

  return (
    <StorefrontFrame locale={locale} path="/early-access">
      <AccountPage title={t("title")} intro={t("intro")}>
        {result ? (
          <Alert
            variant={isEarlyAccessSuccess(result) ? "success" : "error"}
            role={isEarlyAccessSuccess(result) ? "status" : "alert"}
            title={t(earlyAccessResultKey(result))}
            data-testid={`early-access-result-${result}`}
          />
        ) : null}

        {!customer || !state ? (
          <section data-testid="early-access-signed-out" className="flex flex-col gap-4">
            <p>{t("signedOut")}</p>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <a href={`/${locale}/account/sign-in?next=${encodeURIComponent("/early-access")}`}>
                  {tAccount("headerSignIn")}
                </a>
              </Button>
              <Button asChild variant="secondary">
                <a href={`/${locale}/account/sign-up`}>{t("createAccount")}</a>
              </Button>
            </div>
            <p className="text-sm text-[var(--color-text-subtle)]">{t("afterSignUp")}</p>
          </section>
        ) : (
          <section
            data-testid={`early-access-${state.state}`}
            aria-labelledby="early-access-status"
            className="flex flex-col gap-4"
          >
            <h2 id="early-access-status" className="font-display text-xl font-medium">
              {t("statusTitle")}
            </h2>
            <StatusText state={state} t={t} date={date} />
            {state.state === "approved" ? (
              <div>
                <Button asChild>
                  <a href={`${PASS_PATH}?next=${encodeURIComponent(`/${locale}`)}`}>
                    {t("openShop")}
                  </a>
                </Button>
              </div>
            ) : null}
            {canAskForEarlyAccess(state, new Date()) ? (
              <form action={askForEarlyAccess} className="flex flex-col gap-3">
                <input type="hidden" name="locale" value={locale} />
                <Label htmlFor="early-access-note">{t("noteLabel")}</Label>
                <p id="early-access-note-hint" className="text-sm text-[var(--color-text-subtle)]">
                  {t("noteHint", { max: EARLY_ACCESS_TEXT_MAX })}
                </p>
                <Textarea
                  id="early-access-note"
                  name="note"
                  maxLength={EARLY_ACCESS_TEXT_MAX}
                  aria-describedby="early-access-note-hint"
                  defaultValue={state.state === "pending" ? (state.note ?? "") : ""}
                />
                <div>
                  <Button type="submit" data-testid="early-access-submit">
                    {t(state.state === "pending" ? "updateNote" : "ask")}
                  </Button>
                </div>
              </form>
            ) : null}
            <div>
              <SignOutButton locale={locale} label={tAccount("signOut")} />
            </div>
          </section>
        )}
      </AccountPage>
    </StorefrontFrame>
  );
}

function StatusText({
  state,
  t,
  date,
}: {
  readonly state: OwnEarlyAccess;
  readonly t: Awaited<ReturnType<typeof getTranslations>>;
  readonly date: Intl.DateTimeFormat;
}) {
  switch (state.state) {
    case "none":
      return <p>{t("stateNone")}</p>;
    case "pending":
      return <p>{t("statePending", { since: date.format(state.requestedAt) })}</p>;
    case "approved":
      return (
        <p>
          {state.expiresAt
            ? t("stateApproved", { until: date.format(state.expiresAt) })
            : t("stateApprovedUntilLaunch")}
        </p>
      );
    case "expired":
      return <p>{t("stateExpired", { at: date.format(state.expiredAt) })}</p>;
    case "rejected":
    case "revoked":
      return (
        <div className="flex flex-col gap-2">
          <p>{t(state.state === "rejected" ? "stateRejected" : "stateRevoked")}</p>
          {state.reason ? (
            <blockquote className="border-l-4 border-[var(--color-border)] pl-3 text-[var(--color-text-subtle)]">
              {state.reason}
            </blockquote>
          ) : null}
          <p>{t("askAgainAt", { at: date.format(state.askAgainAt) })}</p>
        </div>
      );
  }
}
