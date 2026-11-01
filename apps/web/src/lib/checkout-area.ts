/**
 * The storefront checkout (igs-pharma#116, Sprint 3 E2), kept free of React and Next so it is
 * unit-tested. The contact rules mirror `orders.order.place` (the server decides; this only gives
 * the shopper a message per field before the round trip).
 */

export const CONTACT_FIELDS = ["name", "email", "phone"] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

export type ContactErrorKey = "nameRequired" | "nameTooLong" | "emailInvalid" | "phoneInvalid";

export type ContactValues = Record<ContactField, string>;
export type ContactErrors = Partial<Record<ContactField, ContactErrorKey>>;

export const NAME_MAX = 120;
export const EMAIL_MAX = 254;

/** A phone number with its usual separators removed: `+32 470 12.34/56` → `+32470123456`. */
export const normalisePhone = (value: string): string => value.replace(/[\s.()/-]/g, "");

/** Per-field problems, or an empty object when the contact can be sent. */
export function contactErrors(values: ContactValues): ContactErrors {
  const errors: ContactErrors = {};
  const name = values.name.trim();
  if (!name) errors.name = "nameRequired";
  else if (name.length > NAME_MAX) errors.name = "nameTooLong";
  const email = values.email.trim();
  if (email.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "emailInvalid";
  }
  if (!/^\+?[0-9]{6,15}$/.test(normalisePhone(values.phone))) errors.phone = "phoneInvalid";
  return errors;
}

/**
 * How the order reaches the customer (igs-pharma#202): collected at the pharmacy, or sent to an
 * address in Belgium by Sendcloud. Home delivery exists only while its feature flag is on.
 */
export type DeliveryChoice = "pickup" | "delivery";

/** Delivery is chosen with `delivery=delivery`; anything else, or the flag off, is pickup. */
export const deliveryChoiceOf = (value: unknown, homeDelivery: boolean): DeliveryChoice =>
  homeDelivery && value === "delivery" ? "delivery" : "pickup";

export const ADDRESS_FIELDS = ["street", "postalCode", "city"] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];
export type AddressValues = Record<AddressField, string>;
export type AddressErrorKey =
  | "streetRequired"
  | "streetTooLong"
  | "postalCodeInvalid"
  | "cityRequired"
  | "cityTooLong";
export type AddressErrors = Partial<Record<AddressField, AddressErrorKey>>;

export const STREET_MAX = 120;
export const CITY_MAX = 80;
/** A Belgian postal code: four digits, the first not 0 (the same rule as `orders.order.place`). */
export const BE_POSTAL_CODE = /^[1-9][0-9]{3}$/;

/** Per-field problems of a delivery address, or an empty object when it can be sent. */
export function addressErrors(values: AddressValues): AddressErrors {
  const errors: AddressErrors = {};
  const street = values.street.trim();
  if (!street) errors.street = "streetRequired";
  else if (street.length > STREET_MAX) errors.street = "streetTooLong";
  if (!BE_POSTAL_CODE.test(values.postalCode.trim())) errors.postalCode = "postalCodeInvalid";
  const city = values.city.trim();
  if (!city) errors.city = "cityRequired";
  else if (city.length > CITY_MAX) errors.city = "cityTooLong";
  return errors;
}

/** Why placing the order did not work, as a message key of the `checkout` namespace. */
export type PlaceFailure = "expired" | "cancelled" | "notFound" | "invalid" | "failed";

export function placeFailureOf(code: string): PlaceFailure {
  switch (code) {
    case "orders.checkout_expired":
      return "expired";
    case "orders.checkout_cancelled":
      return "cancelled";
    case "orders.checkout_not_found":
      return "notFound";
    case "kernel.validation_failed":
      return "invalid";
    default:
      return "failed";
  }
}

/** What the server action answers the form with (it redirects on success). */
export interface PlaceState {
  readonly values: ContactValues;
  readonly errors: ContactErrors;
  readonly failure: PlaceFailure | null;
  /** What was chosen, and the address typed, so a refused form keeps them. */
  readonly delivery: DeliveryChoice;
  readonly address: AddressValues;
  readonly addressErrors: AddressErrors;
}

export const EMPTY_ADDRESS: AddressValues = { street: "", postalCode: "", city: "" };

export const EMPTY_PLACE_STATE: PlaceState = {
  values: { name: "", email: "", phone: "" },
  errors: {},
  failure: null,
  delivery: "pickup",
  address: EMPTY_ADDRESS,
  addressErrors: {},
};

/** A UUID from a URL segment or form, else `null`. */
export function uuidOf(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
    ? value
    : null;
}

/** The order's status as a message key of the `order` namespace (`statusPendingPayment`, …). */
export const statusMessageKey = (status: string): string =>
  `status${status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}`;

/** "21 okt. 2026" in Brussels: when an order was placed. */
export function brusselsDate(at: Date, intlLocale: string): string {
  return new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "medium",
    timeZone: "Europe/Brussels",
  }).format(at);
}

/** A status link token from `?t=` (the same shape as the cart cookie), else `null`. */
export const statusTokenOf = (value: unknown): string | null =>
  typeof value === "string" && /^[A-Za-z0-9_-]{22}$/.test(value) ? value : null;

/** "14:35" in Brussels: when a checkout's stock holds lapse. */
export function brusselsTime(at: Date, intlLocale: string): string {
  return new Intl.DateTimeFormat(intlLocale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  }).format(at);
}

/**
 * What the order page says about paying (igs-pharma#116), as a message key of the `order`
 * namespace, or `null` for nothing. `payable`: online payment is configured.
 * - `pay`: waiting for payment, and "Pay now" works (a payment not yet started, or still open);
 * - `paymentSoon`: waiting for payment, but payment is not configured;
 * - `paymentProcessing`: the bank is still confirming (pending, authorized);
 * - `paymentFailed`: the payment failed, was cancelled or lapsed, so the order was cancelled;
 * - `stockShort`: paid, but the stock holds lapsed before the payment came in.
 */
export type PaymentNotice =
  | "pay"
  | "paymentSoon"
  | "paymentProcessing"
  | "paymentFailed"
  | "stockShort";

export function paymentNoticeOf(
  orderStatus: string,
  paymentStatus: string | null,
  payable: boolean,
): PaymentNotice | null {
  if (orderStatus === "paid_stock_short") return "stockShort";
  if (orderStatus === "pending_payment") {
    if (paymentStatus === "pending" || paymentStatus === "authorized") return "paymentProcessing";
    if (paymentStatus === "created" || paymentStatus === "open") {
      return payable ? "pay" : "paymentSoon";
    }
    return null;
  }
  if (
    orderStatus === "cancelled" &&
    (paymentStatus === "failed" || paymentStatus === "canceled" || paymentStatus === "expired")
  ) {
    return "paymentFailed";
  }
  return null;
}

/** The `?payment=` reason the pay route sends back with, else `null`. */
export const payReturnOf = (value: unknown): "unavailable" | null =>
  value === "unavailable" ? "unavailable" : null;
