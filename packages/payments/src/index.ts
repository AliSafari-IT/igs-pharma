/**
 * `@igs/payments` (igs-pharma#116, D-045): the Mollie client. Payment I/O lives here and is used only
 * by the storefront's route handlers and the worker, never inside a command (D-019): the boundary
 * rules allow these two apps and nothing else to import it. Plain `fetch`, no SDK.
 *
 * Only what the shop needs: create a payment (instant methods only, an idempotency key so a retry
 * never makes a second one) and read one back. The webhook trusts nothing but what `getPayment`
 * fetches with our key.
 */

/** Instant methods only (O-2): no bank transfer, whose "paid" arrives days later. */
export const INSTANT_METHODS = ["bancontact", "creditcard", "applepay"] as const;

/** Mollie's payment statuses (the ones the shop stores as they are). */
export const MOLLIE_STATUSES = [
  "open",
  "pending",
  "authorized",
  "paid",
  "failed",
  "canceled",
  "expired",
] as const;
export type MollieStatus = (typeof MOLLIE_STATUSES)[number];

/** A Mollie payment id, as Mollie writes it (also the only thing a webhook call carries). */
export const MOLLIE_PAYMENT_ID = /^tr_[A-Za-z0-9]{4,64}$/;

/** The storefront locales, as Mollie spells them on its payment page. */
const MOLLIE_LOCALES = { nl: "nl_BE", fr: "fr_BE", de: "de_DE", en: "en_US" } as const;
export type ShopLocale = keyof typeof MOLLIE_LOCALES;

export interface CreatePaymentInput {
  readonly amountCents: number;
  readonly description: string;
  readonly redirectUrl: string;
  /** Unset: Mollie calls no webhook (the worker's reconciliation reads the status instead). */
  readonly webhookUrl?: string | undefined;
  readonly locale: ShopLocale;
  /** Ids only, never personal data: Mollie shows metadata in its dashboard. */
  readonly metadata: Readonly<Record<string, string>>;
  /** Our payment id: the same key returns the payment already made instead of a second one. */
  readonly idempotencyKey: string;
}

export interface ProviderPayment {
  readonly id: string;
  readonly status: MollieStatus;
  readonly amountCents: number;
  readonly currency: string;
  /** Where the shopper pays; `null` once the payment is no longer open. */
  readonly checkoutUrl: string | null;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface MollieClient {
  createPayment(input: CreatePaymentInput): Promise<ProviderPayment>;
  getPayment(id: string): Promise<ProviderPayment>;
}

/** A refusal from Mollie or the network. `status` is the HTTP status (0: no answer). Never the body. */
export class MollieError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`mollie.${code} (${status})`);
    this.name = "MollieError";
  }
}

const API = "https://api.mollie.com/v2";
const TIMEOUT_MS = 10_000;

/** 1234 cents → "12.34", as Mollie wants amounts. */
export const centsToValue = (cents: number): string => {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new RangeError("amount must be > 0 cents");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
};

/** "12.34" → 1234; anything else throws (a payment we cannot read is not trusted). */
export const valueToCents = (value: string): number => {
  const match = /^([0-9]{1,9})\.([0-9]{2})$/.exec(value);
  if (!match) throw new MollieError(0, "invalid_amount");
  return Number(match[1]) * 100 + Number(match[2]);
};

interface MolliePaymentBody {
  id?: unknown;
  status?: unknown;
  amount?: { value?: unknown; currency?: unknown };
  metadata?: unknown;
  _links?: { checkout?: { href?: unknown } };
}

/** Reads Mollie's answer strictly: anything unexpected is an error, not a guess. */
function toPayment(body: MolliePaymentBody): ProviderPayment {
  const { id, status, amount, metadata } = body;
  if (typeof id !== "string" || !MOLLIE_PAYMENT_ID.test(id)) throw new MollieError(0, "invalid_id");
  if (typeof status !== "string" || !(MOLLIE_STATUSES as readonly string[]).includes(status)) {
    throw new MollieError(0, "invalid_status");
  }
  if (typeof amount?.value !== "string" || typeof amount.currency !== "string") {
    throw new MollieError(0, "invalid_amount");
  }
  const href = body._links?.checkout?.href;
  const meta: Record<string, string> = {};
  if (metadata && typeof metadata === "object") {
    for (const [key, value] of Object.entries(metadata)) {
      if (typeof value === "string") meta[key] = value;
    }
  }
  return {
    id,
    status: status as MollieStatus,
    amountCents: valueToCents(amount.value),
    currency: amount.currency,
    checkoutUrl: typeof href === "string" && href.startsWith("https://") ? href : null,
    metadata: meta,
  };
}

/**
 * The Mollie client for `apiKey`. `fetchImpl` is for tests. Errors carry the HTTP status and a code,
 * never Mollie's message body (it can echo request data back).
 */
export function createMollieClient(apiKey: string, fetchImpl: typeof fetch = fetch): MollieClient {
  async function call(path: string, init: RequestInit): Promise<ProviderPayment> {
    let response: Response;
    try {
      response = await fetchImpl(`${API}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: "application/json",
          ...(init.headers as Record<string, string> | undefined),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new MollieError(0, "unreachable");
    }
    if (!response.ok) {
      throw new MollieError(response.status, response.status === 404 ? "not_found" : "refused");
    }
    return toPayment((await response.json()) as MolliePaymentBody);
  }

  return {
    createPayment(input) {
      return call("/payments", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey },
        body: JSON.stringify({
          amount: { currency: "EUR", value: centsToValue(input.amountCents) },
          description: input.description,
          redirectUrl: input.redirectUrl,
          ...(input.webhookUrl ? { webhookUrl: input.webhookUrl } : {}),
          method: [...INSTANT_METHODS],
          locale: MOLLIE_LOCALES[input.locale],
          metadata: input.metadata,
        }),
      });
    },
    getPayment(id) {
      if (!MOLLIE_PAYMENT_ID.test(id)) return Promise.reject(new MollieError(0, "invalid_id"));
      return call(`/payments/${id}`, { method: "GET" });
    },
  };
}
