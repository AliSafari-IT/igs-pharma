"use client";

import type { ContentLocale } from "@igs/module-catalog";
import { Alert, Button, Price, TextField, formatPrice } from "@igs/ui";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";

import { placeOrderAction } from "../../app/[locale]/checkout/actions";
import {
  ADDRESS_FIELDS,
  CITY_MAX,
  CONTACT_FIELDS,
  type DeliveryChoice,
  EMAIL_MAX,
  EMPTY_PLACE_STATE,
  NAME_MAX,
  STREET_MAX,
} from "../../lib/checkout-area";
import { ErrorSummary } from "../account/error-summary";

/**
 * What home delivery would cost this checkout (igs-pharma#202), worked out by the server from the
 * staff's settings. Only informs: the fee charged is worked out again when the order is placed.
 */
export interface DeliveryOffer {
  /** The lines, VAT included. */
  readonly itemsCents: number;
  readonly feeCents: number;
  readonly isFree: boolean;
  readonly freeFromCents: number | null;
  readonly missingCents: number | null;
}

interface Props {
  readonly locale: ContentLocale;
  readonly checkoutId: string;
  /** The way prices are written, e.g. `nl-BE`. */
  readonly intl: string;
  /** `null` while home delivery is off: the shop takes pickup orders only. */
  readonly delivery: DeliveryOffer | null;
}
const FIELD_IDS = {
  name: "checkout-name",
  email: "checkout-email",
  phone: "checkout-phone",
  street: "checkout-street",
  postalCode: "checkout-postal-code",
  city: "checkout-city",
} as const;

/**
 * The contact step and "Place order" (igs-pharma#116). Works without JavaScript (a plain form post
 * to the Server Action); with it, the values stay in the fields and each problem is shown under its
 * field and in a summary at the top, read out at once.
 */
export function CheckoutForm({ locale, checkoutId, intl, delivery }: Props) {
  const t = useTranslations("checkout");
  const [state, action, pending] = useActionState(placeOrderAction, EMPTY_PLACE_STATE);
  // what the shopper clicked, else what the server last answered with (a refused form keeps it)
  const [picked, setPicked] = useState<DeliveryChoice | null>(null);
  const choice: DeliveryChoice = delivery ? (picked ?? state.delivery) : "pickup";
  // without JavaScript the address fields stay visible (a radio cannot reveal them): they are only
  // hidden once this script runs and pickup is chosen
  const [scripted, setScripted] = useState(false);
  useEffect(() => setScripted(true), []);
  const items = [
    ...CONTACT_FIELDS.flatMap((field) => {
      const key = state.errors[field];
      return key ? [{ fieldId: FIELD_IDS[field], message: t(key) }] : [];
    }),
    ...ADDRESS_FIELDS.flatMap((field) => {
      const key = state.addressErrors[field];
      return key ? [{ fieldId: FIELD_IDS[field], message: t(key) }] : [];
    }),
  ];
  const fee = choice === "delivery" && delivery ? delivery.feeCents : 0;

  return (
    <form action={action} noValidate className="flex flex-col gap-4" data-testid="checkout-form">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="checkoutId" value={checkoutId} />
      <ErrorSummary title={t("errorSummary")} items={items} />
      {delivery ? (
        <fieldset className="flex flex-col gap-3" data-testid="delivery-choice">
          <legend className="font-display text-xl font-semibold">{t("stepDelivery")}</legend>
          <label className="flex min-h-[44px] items-start gap-3">
            <input
              type="radio"
              name="delivery"
              value="pickup"
              checked={choice === "pickup"}
              onChange={() => setPicked("pickup")}
              className="mt-1.5"
              data-testid="delivery-pickup"
            />
            <span>
              {t("deliveryPickup")} · <strong>{t("deliveryFree")}</strong>
            </span>
          </label>
          <label className="flex min-h-[44px] items-start gap-3">
            <input
              type="radio"
              name="delivery"
              value="delivery"
              checked={choice === "delivery"}
              onChange={() => setPicked("delivery")}
              className="mt-1.5"
              data-testid="delivery-home"
            />
            <span>
              {t("deliveryHome")} ·{" "}
              <strong data-testid="delivery-fee">
                {delivery.isFree ? t("deliveryFree") : formatPrice(delivery.feeCents, intl)}
              </strong>
            </span>
          </label>
          {delivery.isFree && delivery.freeFromCents !== null ? (
            <p className="text-sm" data-testid="delivery-free-reached">
              {t("deliveryFreeReached")}
            </p>
          ) : delivery.missingCents !== null ? (
            <p className="text-sm" data-testid="delivery-missing">
              {t("deliveryMissing", { amount: formatPrice(delivery.missingCents, intl) })}
            </p>
          ) : null}
        </fieldset>
      ) : null}
      {delivery ? (
        <div
          hidden={scripted && choice === "pickup"}
          className="flex flex-col gap-4"
          data-testid="delivery-address"
        >
          <h2 className="font-display text-xl font-semibold">{t("addressTitle")}</h2>
          <p className="text-sm text-[var(--color-text-subtle)]">{t("addressNote")}</p>
          <TextField
            id={FIELD_IDS.street}
            name="street"
            label={t("street")}
            hint={t("streetHint")}
            autoComplete="street-address"
            maxLength={STREET_MAX}
            defaultValue={state.address.street}
            error={state.addressErrors.street ? t(state.addressErrors.street) : undefined}
          />
          <TextField
            id={FIELD_IDS.postalCode}
            name="postalCode"
            label={t("postalCode")}
            autoComplete="postal-code"
            inputMode="numeric"
            maxLength={4}
            defaultValue={state.address.postalCode}
            error={state.addressErrors.postalCode ? t(state.addressErrors.postalCode) : undefined}
          />
          <TextField
            id={FIELD_IDS.city}
            name="city"
            label={t("city")}
            autoComplete="address-level2"
            maxLength={CITY_MAX}
            defaultValue={state.address.city}
            error={state.addressErrors.city ? t(state.addressErrors.city) : undefined}
          />
        </div>
      ) : null}
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
      {delivery ? (
        <p className="flex flex-col gap-1" data-testid="checkout-to-pay-block">
          {choice === "delivery" ? (
            <span className="flex items-baseline gap-2" data-testid="checkout-delivery-line">
              <span>{t("deliveryCost")}</span>
              {delivery.isFree ? (
                <strong>{t("deliveryFree")}</strong>
              ) : (
                <Price cents={fee} locale={intl} />
              )}
            </span>
          ) : null}
          <span className="flex items-baseline gap-2" data-testid="checkout-to-pay">
            <span className="font-semibold">{t("toPay")}</span>
            <Price cents={delivery.itemsCents + fee} locale={intl} vatLabel={t("vatIncluded")} />
          </span>
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending} className="min-h-[44px]" data-testid="place-order">
          {t("placeOrder")}
        </Button>
      </div>
      <p className="text-sm text-[var(--color-text-subtle)]">{t("placeOrderNote")}</p>
    </form>
  );
}
