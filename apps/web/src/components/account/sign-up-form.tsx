"use client";

import { customerAuthClient } from "@igs/auth/customer-client";
import type { ContentLocale } from "@igs/module-catalog";
import { Alert, Button, Link, Stack, TextField } from "@igs/ui";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import {
  EMAIL_MAX,
  type FieldErrorKey,
  type FormField,
  NAME_MAX,
  PASSWORD_MAX,
  type RequestFailureKey,
  VERIFIED_MARKER,
  emailError,
  nameError,
  passwordError,
  requestFailure,
  signUpFieldFailure,
} from "../../lib/account-forms";
import { ErrorSummary } from "./error-summary";
import { PasswordField } from "./password-field";

interface Props {
  readonly locale: ContentLocale;
  /** The customer instance's minimum (`CUSTOMER_PASSWORD_MIN`, 12), passed by the server page. */
  readonly passwordMin: number;
}

type Errors = Record<FormField, FieldErrorKey | null>;
const NO_ERRORS: Errors = { name: null, email: null, password: null };
const FIELD_IDS: Record<FormField, string> = {
  name: "sign-up-name",
  email: "sign-up-email",
  password: "sign-up-password",
};

/**
 * Sign-up (igs-pharma#115, D-044). Whatever the address, a sign-up the server takes ends on the same
 * "check your inbox" panel: a new address gets the confirmation link, an existing one a "you already
 * have an account" mail, and the page cannot tell them apart. No session is opened here.
 */
export function SignUpForm({ locale, passwordMin }: Props) {
  const t = useTranslations("account");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>(NO_ERRORS);
  const [failure, setFailure] = useState<RequestFailureKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const message = (key: FieldErrorKey | null) =>
    key ? t(key, { min: passwordMin, max: PASSWORD_MAX }) : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: Errors = {
      name: nameError(name),
      email: emailError(email),
      password: passwordError(password, passwordMin),
    };
    setErrors(found);
    setFailure(null);
    if (found.name || found.email || found.password) return;
    setBusy(true);
    try {
      const { error } = await customerAuthClient.signUp.email({
        name: name.trim(),
        email: email.trim(),
        password,
        // Better Auth sends the confirmation link back here, with `error=…` added when it fails
        callbackURL: `/${locale}/account/verify-email?status=${VERIFIED_MARKER}`,
      });
      if (!error) {
        setSent(true);
        return;
      }
      const field = signUpFieldFailure(error);
      if (field) setErrors({ ...NO_ERRORS, [field.field]: field.key });
      else setFailure(requestFailure(error));
    } catch {
      setFailure("requestFailed");
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <Stack gap={4}>
        <Alert variant="success" title={t("checkInboxTitle")} data-testid="sign-up-sent">
          {t("signUpCheckInbox")}
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

  const summary = (Object.keys(FIELD_IDS) as FormField[]).flatMap((field) => {
    const text = message(errors[field]);
    return text ? [{ fieldId: FIELD_IDS[field], message: text }] : [];
  });

  return (
    <Stack gap={6}>
      <ErrorSummary title={t("errorSummaryTitle")} items={summary} />
      {failure ? <Alert variant="error" title={t(failure)} /> : null}
      <form noValidate onSubmit={submit} aria-label={t("signUpTitle")}>
        <Stack gap={4}>
          <p className="text-sm text-[var(--color-text-subtle)]">{t("allFieldsRequired")}</p>
          <TextField
            id={FIELD_IDS.name}
            name="name"
            label={t("nameLabel")}
            autoComplete="name"
            required
            maxLength={NAME_MAX}
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={message(errors.name)}
          />
          <TextField
            id={FIELD_IDS.email}
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
            error={message(errors.email)}
          />
          <PasswordField
            id={FIELD_IDS.password}
            name="password"
            label={t("passwordLabel")}
            autoComplete="new-password"
            hint={t("passwordHint", { min: passwordMin })}
            minLength={passwordMin}
            maxLength={PASSWORD_MAX}
            value={password}
            onChange={setPassword}
            error={message(errors.password)}
          />
          <Button type="submit" loading={busy} className="self-start">
            {t("signUpSubmit")}
          </Button>
        </Stack>
      </form>
      <p>
        {t("haveAccount")}{" "}
        <Link href={`/${locale}/account/sign-in`} className="inline-flex min-h-[44px] items-center">
          {t("signInInstead")}
        </Link>
      </p>
    </Stack>
  );
}
