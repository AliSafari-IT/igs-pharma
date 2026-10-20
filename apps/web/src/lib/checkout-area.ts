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
}

export const EMPTY_PLACE_STATE: PlaceState = {
  values: { name: "", email: "", phone: "" },
  errors: {},
  failure: null,
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

/** "14:35" in Brussels: when a checkout's stock holds lapse. */
export function brusselsTime(at: Date, intlLocale: string): string {
  return new Intl.DateTimeFormat(intlLocale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  }).format(at);
}
