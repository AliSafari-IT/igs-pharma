/**
 * `@igs/shipping` (igs-pharma#202, D-019): the Sendcloud client. Carrier I/O lives here and is used
 * only by the worker (labels, cancellations, tracking) and the back-office's label route handler,
 * never inside a command: the boundary rules allow these two apps and nothing else to import it.
 * Plain `fetch`, no SDK, API v2.
 *
 * Only what the shop needs: announce a parcel with its label (our shipment id as its external
 * reference, so a retry finds the parcel already made instead of a second label), read a parcel back,
 * find one by its external reference, cancel one, and fetch a label as a PDF. No product data is ever
 * sent (no customs items, no description): the parcel carries the address and the order reference.
 */

/** Sendcloud's parcel id, as we store it (a positive integer, as text). */
export const SENDCLOUD_PARCEL_ID = /^[0-9]{1,20}$/;

/**
 * Sendcloud parcel statuses the shop acts on (`status.id`; the full list is
 * `GET /api/v2/parcels/statuses`, to be checked against the account before going live).
 */
export const SENDCLOUD_STATUS = {
  /** The carrier delivered the parcel. */
  delivered: 11,
  /** The customer collected it at a service point. */
  collectedByCustomer: 93,
  /** The carrier refused the announcement: no usable label. */
  announcementFailed: 1002,
  cancellationRequested: 1999,
  cancelled: 2000,
} as const;

/** The parcel statuses that mean the customer has it. */
export const DELIVERED_STATUS_IDS: readonly number[] = [
  SENDCLOUD_STATUS.delivered,
  SENDCLOUD_STATUS.collectedByCustomer,
];

export interface CreateParcelInput {
  /** Our shipment id: Sendcloud's `external_reference`, unique per parcel. */
  readonly externalReference: string;
  /** The order reference, `IGS-2026-000123` (shown on the label and in Sendcloud's panel). */
  readonly orderNumber: string;
  readonly name: string;
  /** Street, number and box in one line; Sendcloud reads the house number from it. */
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
  readonly country: string;
  readonly email: string;
  readonly phone: string;
  /** The Sendcloud shipping method (`shipment.id`) the label is made with. */
  readonly shippingMethodId: number;
  readonly weightGrams: number;
}

export interface Parcel {
  /** Sendcloud's parcel id, as text. */
  readonly id: string;
  readonly statusId: number;
  /** Empty while the carrier has not answered the announcement yet. */
  readonly trackingNumber: string | null;
  /** The carrier's (or Sendcloud's) tracking page; https only, else `null`. */
  readonly trackingUrl: string | null;
  readonly carrier: string | null;
  readonly externalReference: string | null;
}

export type CancelOutcome = "cancelled" | "queued" | "gone";

export type LabelFormat = "a4" | "a6";

export interface SendcloudClient {
  createParcel(input: CreateParcelInput): Promise<Parcel>;
  getParcel(id: string): Promise<Parcel>;
  /** The parcel made for `externalReference`, or `null`. */
  findParcel(externalReference: string): Promise<Parcel | null>;
  cancelParcel(id: string): Promise<CancelOutcome>;
  /** The label as a PDF: A4 for an office printer, A6 for a label printer. */
  getLabelPdf(id: string, format: LabelFormat): Promise<Uint8Array>;
}

/** A refusal from Sendcloud or the network. `status` is the HTTP status (0: no answer). Never the body. */
export class SendcloudError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`sendcloud.${code} (${status})`);
    this.name = "SendcloudError";
  }
}

const API = "https://panel.sendcloud.sc/api/v2";
const TIMEOUT_MS = 15_000;
/** A label is a few tens of kilobytes; anything far bigger is not a label. */
const MAX_LABEL_BYTES = 5_000_000;

interface ParcelBody {
  id?: unknown;
  tracking_number?: unknown;
  tracking_url?: unknown;
  external_reference?: unknown;
  carrier?: { code?: unknown } | null;
  status?: { id?: unknown } | null;
}

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() !== "" && value.length <= max ? value.trim() : null;

/** Reads Sendcloud's parcel strictly: anything unexpected is an error, not a guess. */
export function toParcel(body: ParcelBody | null | undefined): Parcel {
  const id = body?.id;
  const parcelId =
    typeof id === "number" && Number.isSafeInteger(id) && id > 0
      ? String(id)
      : typeof id === "string" && SENDCLOUD_PARCEL_ID.test(id)
        ? id
        : null;
  if (!parcelId) throw new SendcloudError(0, "invalid_id");
  const statusId = body?.status?.id;
  if (typeof statusId !== "number" || !Number.isInteger(statusId)) {
    throw new SendcloudError(0, "invalid_status");
  }
  const url = text(body?.tracking_url, 500);
  return {
    id: parcelId,
    statusId,
    trackingNumber: text(body?.tracking_number, 64),
    trackingUrl: url && /^https:\/\/[^\s<>"']+$/.test(url) ? url : null,
    carrier: text(body?.carrier?.code, 40),
    externalReference: text(body?.external_reference, 100),
  };
}

/** Grams → Sendcloud's kilograms with three decimals ("1.000"). */
export const gramsToKilos = (grams: number): string => {
  if (!Number.isSafeInteger(grams) || grams <= 0) throw new RangeError("weight must be > 0 grams");
  return `${Math.floor(grams / 1000)}.${String(grams % 1000).padStart(3, "0")}`;
};

/**
 * The Sendcloud client for a key pair. `fetchImpl` is for tests. Errors carry the HTTP status and a
 * code, never Sendcloud's message body (it can echo the address back).
 */
export function createSendcloudClient(
  publicKey: string,
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): SendcloudClient {
  const authorization = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`;

  async function call(path: string, init: RequestInit, accept = "application/json") {
    let response: Response;
    try {
      response = await fetchImpl(`${API}${path}`, {
        ...init,
        headers: {
          authorization,
          accept,
          ...(init.headers as Record<string, string> | undefined),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new SendcloudError(0, "unreachable");
    }
    return response;
  }

  async function json(path: string, init: RequestInit): Promise<unknown> {
    const response = await call(path, init);
    if (!response.ok) {
      throw new SendcloudError(response.status, response.status === 404 ? "not_found" : "refused");
    }
    try {
      return await response.json();
    } catch {
      throw new SendcloudError(response.status, "invalid_body");
    }
  }

  const checkId = (id: string) => {
    if (!SENDCLOUD_PARCEL_ID.test(id)) throw new SendcloudError(0, "invalid_id");
  };

  return {
    async createParcel(input) {
      const body = (await json("/parcels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          parcel: {
            name: input.name,
            address: input.street,
            postal_code: input.postalCode,
            city: input.city,
            country: input.country,
            email: input.email,
            telephone: input.phone,
            order_number: input.orderNumber,
            external_reference: input.externalReference,
            weight: gramsToKilos(input.weightGrams),
            request_label: true,
            shipment: { id: input.shippingMethodId },
          },
        }),
      })) as { parcel?: ParcelBody };
      return toParcel(body.parcel);
    },
    async getParcel(id) {
      checkId(id);
      const body = (await json(`/parcels/${id}`, { method: "GET" })) as { parcel?: ParcelBody };
      return toParcel(body.parcel);
    },
    async findParcel(externalReference) {
      const query = new URLSearchParams({ external_reference: externalReference });
      const body = (await json(`/parcels?${query}`, { method: "GET" })) as { parcels?: unknown };
      if (!Array.isArray(body.parcels)) throw new SendcloudError(0, "invalid_list");
      const found = body.parcels
        .map((parcel) => toParcel(parcel as ParcelBody))
        .find((parcel) => parcel.externalReference === externalReference);
      return found ?? null;
    },
    async cancelParcel(id) {
      checkId(id);
      const response = await call(`/parcels/${id}/cancel`, { method: "POST" });
      // 410: already cancelled or deleted; 404: no such parcel (never announced)
      if (response.status === 410 || response.status === 404) return "gone";
      if (!response.ok) throw new SendcloudError(response.status, "refused");
      const body = (await response.json().catch(() => null)) as { status?: unknown } | null;
      if (body?.status === "queued") return "queued";
      return "cancelled";
    },
    async getLabelPdf(id, format) {
      checkId(id);
      const kind = format === "a6" ? "label_printer" : "normal_printer";
      const response = await call(
        `/labels/${kind}/${id}${format === "a4" ? "?start_from=0" : ""}`,
        { method: "GET" },
        "application/pdf",
      );
      if (!response.ok) {
        throw new SendcloudError(
          response.status,
          response.status === 404 ? "not_found" : "refused",
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      // a PDF starts with "%PDF"; anything else (an HTML error page) is not passed on
      const isPdf =
        bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
      if (!isPdf || bytes.length > MAX_LABEL_BYTES) throw new SendcloudError(0, "invalid_label");
      return bytes;
    },
  };
}
