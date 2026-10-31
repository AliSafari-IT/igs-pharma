import { identityErrorMessage } from "./identity-labels";

/** What the delivery settings form says for each error code (igs-pharma#202). */
const ERRORS: Record<string, string> = {
  "orders.delivery_price_invalid":
    "The delivery price must be an amount from 0 to 50.00 euros, with at most two decimals.",
  "orders.delivery_free_from_invalid":
    "The free-delivery value must be empty (never free) or an amount from 0 to 1000.00 euros, with at most two decimals.",
  "kernel.forbidden": "You are not allowed to change the delivery settings.",
  "kernel.validation_failed": "That was not a valid amount. Check both fields and try again.",
};

export const deliveryErrorMessage = (code: string | undefined): string =>
  (code && Object.hasOwn(ERRORS, code) && ERRORS[code]) || identityErrorMessage(code);
