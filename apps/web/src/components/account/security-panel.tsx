"use client";

import { customerAuthClient } from "@igs/auth/customer-client";
import { Alert, Button, Link, Stack } from "@igs/ui";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import {
  type AuthFailure,
  type FieldErrorKey,
  PASSWORD_MAX,
  passwordError,
} from "../../lib/account-forms";
import { ErrorSummary } from "./error-summary";
import { PasswordField } from "./password-field";

interface Props {
  readonly locale: string;
  /** The sign-in is at most ten minutes old (D-044): else the password cannot be changed yet. */
  readonly fresh: boolean;
  readonly passwordMin: number;
}

const CURRENT_ID = "security-current-password";
const NEW_ID = "security-new-password";

type Notice = "passwordChanged" | "currentPasswordWrong" | "tooManyAttempts" | "requestFailed";

/** What the server said to a refused password change, as a message key (never reveals more than needed). */
function changeFailure(error: AuthFailure): Notice | "passwordTooShort" | "passwordTooLong" {
  if (error?.status === 429) return "tooManyAttempts";
  switch (error?.code) {
    case "INVALID_PASSWORD":
      return "currentPasswordWrong";
    case "PASSWORD_TOO_SHORT":
      return "passwordTooShort";
    case "PASSWORD_TOO_LONG":
      return "passwordTooLong";
    default:
      return "requestFailed";
  }
}

/**
 * Change the password and sign out on other devices (igs-pharma#115 PR C). Both go to the customer
 * Better Auth instance from the browser. A change of password also ends every other session, so a
 * stolen session does not outlive it.
 */
export function SecurityPanel({ locale, fresh, passwordMin }: Props) {
  const t = useTranslations("account");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [currentKey, setCurrentKey] = useState<FieldErrorKey | null>(null);
  const [nextKey, setNextKey] = useState<FieldErrorKey | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [others, setOthers] = useState<"done" | "failed" | null>(null);

  const message = (key: string) => t(key, { min: passwordMin, max: PASSWORD_MAX });

  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const foundCurrent = current === "" ? "passwordRequired" : null;
    const foundNext = passwordError(next, passwordMin);
    setCurrentKey(foundCurrent);
    setNextKey(foundNext);
    setNotice(null);
    if (foundCurrent || foundNext) return;
    setBusy(true);
    try {
      const { error } = await customerAuthClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      });
      if (!error) {
        setNotice("passwordChanged");
        setCurrent("");
        setNext("");
      } else {
        const failure = changeFailure(error);
        if (failure === "passwordTooShort" || failure === "passwordTooLong") setNextKey(failure);
        else setNotice(failure);
        setCurrent("");
      }
    } catch {
      setNotice("requestFailed");
    }
    setBusy(false);
  }

  async function signOutOthers() {
    setOthers(null);
    try {
      const { error } = await customerAuthClient.revokeOtherSessions();
      setOthers(error ? "failed" : "done");
    } catch {
      setOthers("failed");
    }
  }

  const summary = [
    ...(currentKey ? [{ fieldId: CURRENT_ID, message: message(currentKey) }] : []),
    ...(nextKey ? [{ fieldId: NEW_ID, message: message(nextKey) }] : []),
  ];

  return (
    <Stack gap={8}>
      <section aria-labelledby="password-heading" className="flex flex-col gap-4">
        <h2 id="password-heading" className="font-display text-xl font-medium">
          {t("changePasswordTitle")}
        </h2>
        {fresh ? (
          <>
            <ErrorSummary title={t("errorSummaryTitle")} items={summary} />
            {notice ? (
              <Alert
                variant={notice === "passwordChanged" ? "success" : "error"}
                role={notice === "passwordChanged" ? "status" : "alert"}
                title={t(notice)}
                data-testid={`security-${notice}`}
              />
            ) : null}
            <form noValidate onSubmit={change} aria-label={t("changePasswordTitle")}>
              <Stack gap={4}>
                <PasswordField
                  id={CURRENT_ID}
                  name="currentPassword"
                  label={t("currentPasswordLabel")}
                  autoComplete="current-password"
                  maxLength={PASSWORD_MAX}
                  value={current}
                  onChange={setCurrent}
                  error={currentKey ? message(currentKey) : undefined}
                />
                <PasswordField
                  id={NEW_ID}
                  name="newPassword"
                  label={t("newPasswordLabel")}
                  autoComplete="new-password"
                  hint={t("passwordHint", { min: passwordMin })}
                  minLength={passwordMin}
                  maxLength={PASSWORD_MAX}
                  value={next}
                  onChange={setNext}
                  error={nextKey ? message(nextKey) : undefined}
                />
                <Button type="submit" loading={busy} className="self-start">
                  {t("changePasswordSubmit")}
                </Button>
              </Stack>
            </form>
          </>
        ) : (
          <Alert variant="info" title={t("freshNeededTitle")} data-testid="security-fresh-needed">
            <p>{t("freshNeededBody")}</p>
            <Link
              href={`/${locale}/account/sign-in?next=${encodeURIComponent("/account/security")}`}
              className="inline-flex min-h-[44px] items-center"
            >
              {t("signInAgain")}
            </Link>
          </Alert>
        )}
      </section>

      <section aria-labelledby="sessions-heading" className="flex flex-col gap-3">
        <h2 id="sessions-heading" className="font-display text-xl font-medium">
          {t("otherSessionsTitle")}
        </h2>
        <p>{t("otherSessionsBody")}</p>
        {others ? (
          <Alert
            variant={others === "done" ? "success" : "error"}
            role={others === "done" ? "status" : "alert"}
            title={t(others === "done" ? "otherSessionsDone" : "requestFailed")}
          />
        ) : null}
        <Button type="button" variant="secondary" onClick={signOutOthers} className="self-start">
          {t("signOutOthers")}
        </Button>
      </section>
    </Stack>
  );
}
