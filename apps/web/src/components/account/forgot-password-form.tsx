"use client";

import { customerAuthClient } from "@igs/auth/customer-client";
import type { ContentLocale } from "@igs/module-catalog";
import { Alert, Button, Link, Stack, TextField } from "@igs/ui";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import {
  EMAIL_MAX,
  type FieldErrorKey,
  type RequestFailureKey,
  emailError,
  requestFailure,
} from "../../lib/account-forms";
import { ErrorSummary } from "./error-summary";

interface Props {
  readonly locale: ContentLocale;
}

const EMAIL_ID = "forgot-email";

/**
 * Asks for a reset link (igs-pharma#115, D-044). The server answers the same for any address, and so
 * does this page: one "check your inbox" panel, whether or not the address has an account.
 */
export function ForgotPasswordForm({ locale }: Props) {
  const t = useTranslations("account");
  const [email, setEmail] = useState("");
  const [emailKey, setEmailKey] = useState<FieldErrorKey | null>(null);
  const [failure, setFailure] = useState<RequestFailureKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = emailError(email);
    setEmailKey(found);
    setFailure(null);
    if (found) return;
    setBusy(true);
    try {
      const { error } = await customerAuthClient.requestPasswordReset({
        email: email.trim(),
        // the mailed link passes through Better Auth, which lands here with `?token=…`
        redirectTo: `/${locale}/account/reset-password`,
      });
      if (!error) {
        setSent(true);
        return;
      }
      setFailure(requestFailure(error));
    } catch {
      setFailure("requestFailed");
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <Stack gap={4}>
        <Alert variant="success" title={t("checkInboxTitle")} data-testid="forgot-sent">
          {t("forgotCheckInbox")}
        </Alert>
        <p>
          <Link
            href={`/${locale}/account/sign-in`}
            className="inline-flex min-h-[44px] items-center"
          >
            {t("backToSignIn")}
          </Link>
        </p>
      </Stack>
    );
  }

  return (
    <Stack gap={6}>
      <ErrorSummary
        title={t("errorSummaryTitle")}
        items={emailKey ? [{ fieldId: EMAIL_ID, message: t(emailKey) }] : []}
      />
      {failure ? <Alert variant="error" title={t(failure)} /> : null}
      <form noValidate onSubmit={submit} aria-label={t("forgotTitle")}>
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
          <Button type="submit" loading={busy} className="self-start">
            {t("forgotSubmit")}
          </Button>
        </Stack>
      </form>
      <p>
        <Link href={`/${locale}/account/sign-in`} className="inline-flex min-h-[44px] items-center">
          {t("backToSignIn")}
        </Link>
      </p>
    </Stack>
  );
}
