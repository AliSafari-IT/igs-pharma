/**
 * Home delivery: what it costs and when it is free (igs-pharma#202). Pure maths and limits, no
 * database: the settings table, the staff command and the storefront all use these. Money is whole
 * cents and always includes VAT.
 */

/**
 * Until staff set their own values (`orders.delivery_settings`), delivery costs this much and is free
 * from this order value. Placeholders from the milestone-5 plan: the back-office page says so.
 */
export const DELIVERY_DEFAULT_PRICE_CENTS = 495;
export const DELIVERY_DEFAULT_FREE_FROM_CENTS = 4900;

/** Database and command bounds: a sensible upper limit so a typo cannot charge or give away too much. */
export const MAX_DELIVERY_PRICE_CENTS = 5_000;
export const MAX_FREE_FROM_CENTS = 100_000;

/**
 * Belgian VAT on transport services, in basis points (21 %). The delivery price includes it, so the
 * VAT part is cut out of the price, never added on top. To be confirmed with the accountant.
 */
export const DELIVERY_VAT_RATE_BP = 2_100;

/** How an order reaches the customer: collected at the pharmacy (free) or sent by Sendcloud. */
export const DELIVERY_METHODS = ["pickup", "delivery"] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

/** Home delivery goes to Belgium only for now (international delivery is out of scope, #202). */
export const DELIVERY_COUNTRY = "BE";
/** A Belgian postal code: four digits, the first not 0. */
export const BE_POSTAL_CODE_PATTERN = /^[1-9][0-9]{3}$/;

/** The two numbers staff control. `freeFromCents` is `null` when delivery is never free. */
export interface DeliveryRates {
  readonly priceCents: number;
  readonly freeFromCents: number | null;
}

export const DELIVERY_DEFAULTS: DeliveryRates = {
  priceCents: DELIVERY_DEFAULT_PRICE_CENTS,
  freeFromCents: DELIVERY_DEFAULT_FREE_FROM_CENTS,
};

/** 0 to the limit, whole cents. Free delivery is a price of 0. */
export const isValidDeliveryPrice = (cents: number): boolean =>
  Number.isSafeInteger(cents) && cents >= 0 && cents <= MAX_DELIVERY_PRICE_CENTS;

/** `null` means "never free"; otherwise 0 to the limit, whole cents. */
export const isValidFreeFrom = (cents: number | null): boolean =>
  cents === null || (Number.isSafeInteger(cents) && cents >= 0 && cents <= MAX_FREE_FROM_CENTS);

/**
 * What a customer pays for delivery on an order worth `itemsTotalCents` (the lines, VAT included):
 * nothing once the order reaches the free-delivery value, exactly AT it included, else the price.
 */
export function deliveryFeeCents(rates: DeliveryRates, itemsTotalCents: number): number {
  if (rates.freeFromCents !== null && itemsTotalCents >= rates.freeFromCents) return 0;
  return rates.priceCents;
}

/**
 * How much more the customer must order to get free delivery, for "add € X more": `null` when there
 * is no free-delivery value or the order already reaches it.
 */
export function freeDeliveryMissingCents(
  rates: DeliveryRates,
  itemsTotalCents: number,
): number | null {
  if (rates.freeFromCents === null || itemsTotalCents >= rates.freeFromCents) return null;
  return rates.freeFromCents - itemsTotalCents;
}

/** The VAT part of a delivery fee that includes VAT (half up, integer arithmetic). */
export function deliveryVatCents(feeCents: number): number {
  const divisor = 10_000 + DELIVERY_VAT_RATE_BP;
  return Math.floor((2 * feeCents * DELIVERY_VAT_RATE_BP + divisor) / (2 * divisor));
}

/**
 * Reads what staff typed as euros into cents: "4,95", "4.95", "5", "5,5" (a comma or a point, at
 * most two decimals, no sign, no thousands separator). `null` when it is anything else, so the form
 * says "not valid" instead of guessing.
 */
export function parseEuroAmount(text: string): number | null {
  const match = /^(\d{1,6})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const euros = Number(match[1]);
  const cents = match[2] === undefined ? 0 : Number(match[2].padEnd(2, "0"));
  return euros * 100 + cents;
}

/** Cents as the amount staff see and type: `4.95` (a point; the page adds the euro sign). */
export const formatEuroAmount = (cents: number): string => (cents / 100).toFixed(2);
