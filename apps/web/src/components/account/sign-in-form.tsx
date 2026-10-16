"use client";

import { customerAuthClient } from "@igs/auth/customer-client";
import type { ContentLocale } from "@igs/module-catalog";
import { Alert, Button, Link, Stack, TextField } from "@igs/ui";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import {
  EMAIL_MAX,
  type FieldErrorKey,
  PASSWORD_MAX,
  type SignInFailureKey,
  emailError,
  signInFailure,
} from "../../lib/account-forms";
import { ErrorSummary } from "./error-summary";
import { PasswordField } from "./password-field";

interface Props {
  readonly locale: ContentLocale;
}

const EMAIL_ID = "sign-in-email";
const PASSWORD_ID = "sign-in-password";

/**
 * Customer sign-in (igs-pharma#115, D-044). A refused sign-in shows one message whatever the reason,
 * so the page never says whether an address has an account (see `signInFailure`). The password is
 * only checked for presence here: its length rule is for choosing one, not for typing it.
 */
export function SignInForm({ locale }: Props) {
  const t = useTranslations("account");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailKey, setEmailKey] = useState<FieldErrorKey | null>(null);
  const [passwordKey, setPasswordKey] = useState<FieldErrorKey | null>(null);
  const [failure, setFailure] = useState<SignInFailureKey | "requestFailed" | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const foundEmail = emailError(email);
    const foundPassword = password === "" ? "passwordRequired" : null;
    setEmailKey(foundEmail);
    setPasswordKey(foundPassword);
    setFailure(null);
    if (foundEmail || foundPassword) return;
    setBusy(true);
    try {
      // no callbackURL: Better Auth's client would follow it after a successful sign-in
      const { error } = await customerAuthClient.signIn.email({ email: email.trim(), password });
      if (!error) {
        // a full load, so the server renders the page with the new session cookie
        window.location.assign(`/${locale}`);
        return;
      }
      setFailure(signInFailure(error));
      setPassword("");
    } catch {
      setFailure("requestFailed");
    }
    setBusy(false);
  }

  const summary = [
    ...(emailKey ? [{ fieldId: EMAIL_ID, message: t(emailKey) }] : []),
    ...(passwordKey ? [{ fieldId: PASSWORD_ID, message: t(passwordKey) }] : []),
  ];

  return (
    <Stack gap={6}>
      <ErrorSummary title={t("errorSummaryTitle")} items={summary} />
      {failure ? <Alert variant="error" title={t(failure)} data-testid="sign-in-failed" /> : null}
      <form noValidate onSubmit={submit} aria-label={t("signInTitle")}>
        <Stack gap={4}>
          <TextField
            id={EMAIL_ID}
            name="email"
            type="email"
            label={t("emailLabel")}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="email"
            required
            maxLength={EMAIL_MAX}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={emailKey ? t(emailKey) : undefined}
          />
          <PasswordField
            id={PASSWORD_ID}
            name="password"
            label={t("passwordLabel")}
            autoComplete="current-password"
            maxLength={PASSWORD_MAX}
            value={password}
            onChange={setPassword}
            error={passwordKey ? t(passwordKey) : undefined}
          />
          <Button type="submit" loading={busy} className="self-start">
            {t("signInSubmit")}
          </Button>
        </Stack>
      </form>
      <Stack gap={1} align="start">
        <Link
          href={`/${locale}/account/forgot-password`}
          className="inline-flex min-h-[44px] items-center"
        >
          {t("forgotLink")}
        </Link>
        <p>
          {t("noAccount")}{" "}
          <Link
            href={`/${locale}/account/sign-up`}
            className="inline-flex min-h-[44px] items-center"
          >
            {t("createAccount")}
          </Link>
        </p>
      </Stack>
    </Stack>
  );
}
