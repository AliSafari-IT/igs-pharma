"use client";

import { customerAuthClient } from "@igs/auth/customer-client";
import type { ContentLocale } from "@igs/module-catalog";
import { Alert, Button, Link, Stack } from "@igs/ui";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import {
  type FieldErrorKey,
  PASSWORD_MAX,
  type ResetFailureKey,
  passwordError,
  resetFailure,
} from "../../lib/account-forms";
import { ErrorSummary } from "./error-summary";
import { PasswordField } from "./password-field";

interface Props {
  readonly locale: ContentLocale;
  /** From the mailed link (`?token=…`), checked for shape by the server page. */
  readonly token: string;
  readonly passwordMin: number;
}

const PASSWORD_ID = "reset-password";

/**
 * Chooses a new password from a reset link (igs-pharma#115, D-044). Success signs the customer out
 * everywhere (`revokeSessionsOnPasswordReset`) and sends them to sign in with the new password.
 */
export function ResetPasswordForm({ locale, token, passwordMin }: Props) {
  const t = useTranslations("account");
  const [password, setPassword] = useState("");
  const [passwordKey, setPasswordKey] = useState<FieldErrorKey | null>(null);
  const [failure, setFailure] = useState<ResetFailureKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const message = (key: FieldErrorKey | null) =>
    key ? t(key, { min: passwordMin, max: PASSWORD_MAX }) : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = passwordError(password, passwordMin);
    setPasswordKey(found);
    setFailure(null);
    if (found) return;
    setBusy(true);
    try {
      const { error } = await customerAuthClient.resetPassword({ newPassword: password, token });
      if (!error) {
        setDone(true);
        return;
      }
      const key = resetFailure(error);
      if (key === "passwordTooShort" || key === "passwordTooLong") setPasswordKey(key);
      else setFailure(key);
    } catch {
      setFailure("requestFailed");
    }
    setBusy(false);
  }

  if (done) {
    return (
      <Stack gap={4}>
        <Alert variant="success" title={t("resetDoneTitle")} data-testid="reset-done">
          {t("resetDoneBody")}
        </Alert>
        <p>
          <Link
            href={`/${locale}/account/sign-in`}
            className="inline-flex min-h-[44px] items-center"
          >
            {t("goToSignIn")}
          </Link>
        </p>
      </Stack>
    );
  }

  const passwordMessage = message(passwordKey);
  return (
    <Stack gap={6}>
      <ErrorSummary
        title={t("errorSummaryTitle")}
        items={passwordMessage ? [{ fieldId: PASSWORD_ID, message: passwordMessage }] : []}
      />
      {failure ? (
        <Alert variant="error" title={t(failure)}>
          {failure === "resetLinkInvalid" ? (
            <Link href={`/${locale}/account/forgot-password`}>{t("requestNewLink")}</Link>
          ) : null}
        </Alert>
      ) : null}
      <form noValidate onSubmit={submit} aria-label={t("resetTitle")}>
        <Stack gap={4}>
          <PasswordField
            id={PASSWORD_ID}
            name="password"
            label={t("newPasswordLabel")}
            autoComplete="new-password"
            hint={t("passwordHint", { min: passwordMin })}
            minLength={passwordMin}
            maxLength={PASSWORD_MAX}
            value={password}
            onChange={setPassword}
            error={passwordMessage}
          />
          <Button type="submit" loading={busy} className="self-start">
            {t("resetSubmit")}
          </Button>
        </Stack>
      </form>
    </Stack>
  );
}
