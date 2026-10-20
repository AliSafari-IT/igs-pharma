"use client";

import type { ContentLocale } from "@igs/module-catalog";
import { Alert, Button, TextField } from "@igs/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { placeOrderAction } from "../../app/[locale]/checkout/actions";
import { CONTACT_FIELDS, EMAIL_MAX, EMPTY_PLACE_STATE, NAME_MAX } from "../../lib/checkout-area";
import { ErrorSummary } from "../account/error-summary";

interface Props {
  readonly locale: ContentLocale;
  readonly checkoutId: string;
}

const FIELD_IDS = {
  name: "checkout-name",
  email: "checkout-email",
  phone: "checkout-phone",
} as const;

/**
 * The contact step and "Place order" (igs-pharma#116). Works without JavaScript (a plain form post
 * to the Server Action); with it, the values stay in the fields and each problem is shown under its
 * field and in a summary at the top, read out at once.
 */
export function CheckoutForm({ locale, checkoutId }: Props) {
  const t = useTranslations("checkout");
  const [state, action, pending] = useActionState(placeOrderAction, EMPTY_PLACE_STATE);
  const items = CONTACT_FIELDS.flatMap((field) => {
    const key = state.errors[field];
    return key ? [{ fieldId: FIELD_IDS[field], message: t(key) }] : [];
  });

  return (
    <form action={action} noValidate className="flex flex-col gap-4" data-testid="checkout-form">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="checkoutId" value={checkoutId} />
      <ErrorSummary title={t("errorSummary")} items={items} />
      {state.failure ? (
        <Alert
          variant="error"
          role="alert"
          title={t(`failure${state.failure.charAt(0).toUpperCase()}${state.failure.slice(1)}`)}
          data-testid={`checkout-failure-${state.failure}`}
        />
      ) : null}
      <TextField
        id={FIELD_IDS.name}
        name="name"
        label={t("name")}
        autoComplete="name"
        required
        maxLength={NAME_MAX}
        defaultValue={state.values.name}
        error={state.errors.name ? t(state.errors.name) : undefined}
      />
      <TextField
        id={FIELD_IDS.email}
        name="email"
        type="email"
        label={t("email")}
        hint={t("emailHint")}
        autoComplete="email"
        required
        maxLength={EMAIL_MAX}
        defaultValue={state.values.email}
        error={state.errors.email ? t(state.errors.email) : undefined}
      />
      <TextField
        id={FIELD_IDS.phone}
        name="phone"
        type="tel"
        label={t("phone")}
        hint={t("phoneHint")}
        autoComplete="tel"
        required
        defaultValue={state.values.phone}
        error={state.errors.phone ? t(state.errors.phone) : undefined}
      />
      <div>
        <Button type="submit" disabled={pending} className="min-h-[44px]" data-testid="place-order">
          {t("placeOrder")}
        </Button>
      </div>
      <p className="text-sm text-[var(--color-text-subtle)]">{t("placeOrderNote")}</p>
    </form>
  );
}
