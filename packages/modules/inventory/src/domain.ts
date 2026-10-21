/**
 * Inventory domain rules (igs-pharma#53, domain-model §4), free of I/O and of imports: drizzle-kit
 * loads this file through `schema.ts`.
 */

/** Belgian national product code: exactly 7 digits (the same rule as the catalog). */
const isValidCnk = (value: string): boolean => /^[0-9]{7}$/.test(value);

export const LOCATION_KINDS = ["pharmacy"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

/**
 * Why stock moved: a CSV count (`import`, retired by igs-pharma#166; a `reconciliation` of counted
 * lots replaces it), a counted change (breakage, loss…), fixing an earlier mistake, or a
 * sale picked for an order (`sale`, written when a reservation is consumed, igs-pharma#99).
 */
export const MOVEMENT_REASONS = [
  "import",
  "reconciliation",
  "adjustment",
  "correction",
  "sale",
  "receipt",
  "return",
] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

/** The reasons staff pick in the Adjust dialog. */
export const ADJUST_REASONS = ["adjustment", "correction"] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];

/**
 * The one location of v1, "Saint-Gilles pharmacy", seeded with this fixed id by migration
 * `inventory_v1_location`. Multi-location is a later slice; every v1 operation uses it.
 */
export const DEFAULT_LOCATION_ID = "0192f000-0000-7000-8000-000000000001";

export const MAX_IMPORT_ROWS = 5_000;
export const MAX_QUANTITY = 1_000_000;
/** How long a prepared import (a previewed file) could be confirmed (the retired CSV import). */
export const IMPORT_PLAN_TTL_MS = 60 * 60 * 1000;
/** A count file's size limit in characters (5 000 rows fit comfortably). */
export const MAX_IMPORT_CHARS = 256_000;

/** One line of a count file (igs-pharma#166): a lot and how many units of it were counted. */
export interface CountCsvRow {
  /** 1-based line number in the file, for error messages. */
  readonly line: number;
  readonly cnk: string;
  /** `null`: the product's untracked (`no_lot`) stock. */
  readonly lotNumber: string | null;
  /** `YYYY-MM-DD`; `null` when the file gives none. */
  readonly expiryDate: string | null;
  readonly counted: number;
}

/** A problem with the file: `line` 0 is the file as a whole. */
export interface StockCsvError {
  readonly line: number;
  readonly code: string;
}

export interface ParsedCountCsv {
  readonly rows: readonly CountCsvRow[];
  readonly errors: readonly StockCsvError[];
}

const COUNT_HEADER =
  /^\s*cnk\s*;\s*(lot|lot_number|lotnummer|lot number)\s*;\s*(expiry|expiry_date|vervaldatum|expiration)\s*;\s*(counted|count|quantity|qty|aantal|quantité)\s*$/i;

/** A field without one pair of surrounding double quotes (`""` inside stands for one `"`). */
const unquote = (field: string) =>
  /^".*"$/.test(field) ? field.slice(1, -1).replaceAll('""', '"').trim() : field;

/** `YYYY-MM-DD` or the Belgian `DD/MM/YYYY` (also `DD-MM-YYYY`, `DD.MM.YYYY`) as `YYYY-MM-DD`. */
function parseExpiry(text: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const local = /^(\d{2})[/.-](\d{2})[/.-](\d{4})$/.exec(text);
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : local ? [local[3], local[2], local[1]] : [];
  if (!y || !m || !d) return null;
  const date = new Date(`${y}-${m}-${d}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${y}-${m}-${d}`
    ? null
    : `${y}-${m}-${d}`;
}

/**
 * Parses a count file (igs-pharma#166): one `cnk;lot;expiry;counted` per line, an optional header,
 * blank lines and `#` comments ignored. An empty lot is the product's untracked stock; an empty
 * expiry leaves the lot to be found by its number alone. `counted` is how many units of that lot
 * are in the web pool. Every line is checked, so all problems are reported at once. Spreadsheet
 * exports are accepted as they come: any line ending, a byte-order mark, quoted fields.
 */
export function parseCountCsv(text: string): ParsedCountCsv {
  const rows: CountCsvRow[] = [];
  const errors: StockCsvError[] = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  lines.forEach((raw, index) => {
    const line = index + 1;
    const content = raw.trim();
    if (content === "" || content.startsWith("#")) return;
    const parts = content.split(";").map((p) => unquote(p.trim()));
    if (rows.length === 0 && errors.length === 0 && COUNT_HEADER.test(parts.join(";"))) return;
    if (parts.length !== 4) {
      errors.push({ line, code: "inventory.row_malformed" });
      return;
    }
    const [cnk = "", lotText = "", expiryText = "", countedText = ""] = parts;
    if (!isValidCnk(cnk)) {
      errors.push({ line, code: "inventory.cnk_invalid" });
      return;
    }
    if (lotText !== "" && !LOT_NUMBER_PATTERN.test(lotText)) {
      errors.push({ line, code: "inventory.lot_number_invalid" });
      return;
    }
    const expiryDate = expiryText === "" ? null : parseExpiry(expiryText);
    if (expiryText !== "" && (expiryDate === null || lotText === "")) {
      errors.push({ line, code: "inventory.expiry_invalid" });
      return;
    }
    const counted = /^[0-9]{1,7}$/.test(countedText) ? Number(countedText) : Number.NaN;
    if (!Number.isInteger(counted) || counted > MAX_QUANTITY) {
      errors.push({ line, code: "inventory.quantity_invalid" });
      return;
    }
    rows.push({ line, cnk, lotNumber: lotText === "" ? null : lotText, expiryDate, counted });
  });
  if (rows.length === 0 && errors.length === 0)
    errors.push({ line: 0, code: "inventory.import_empty" });
  if (rows.length > MAX_IMPORT_ROWS) errors.unshift({ line: 0, code: "inventory.too_many_rows" });
  return { rows, errors };
}

// ── reservations (igs-pharma#99, domain-model §4) ─────────────────────────────────────────────────

/** A `hold` is a checkout in progress and expires; an `order` exists and never expires on its own. */
export const RESERVATION_KINDS = ["hold", "order"] as const;
export type ReservationKind = (typeof RESERVATION_KINDS)[number];

/**
 * The four states and their arrows (the database forbids the others, migration 0038):
 * `active` → `released` | `consumed` | `expired`; a `hold` may become an `order` while it stays
 * `active`. Only a `hold` can expire; only an `order` can be consumed. The three end states are final.
 */
export const RESERVATION_STATUSES = ["active", "released", "consumed", "expired"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/**
 * A count of web-pool lots (igs-pharma#166, ADR 0011 §1): `open` while it is a preview, then
 * `applied` (its differences are booked) or `discarded`. It never overwrites stock silently.
 */
export const RECONCILIATION_STATUSES = ["open", "applied", "discarded"] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];
/** Where the counts came from: a count file, or typed in on a product's stock page. */
export const RECONCILIATION_SOURCES = ["csv", "typed"] as const;
export type ReconciliationSource = (typeof RECONCILIATION_SOURCES)[number];

/**
 * An order reservation's share of one lot (igs-pharma#165, ADR 0011 §4): `active` while it stands,
 * `superseded` when the order was allocated again, `consumed` at pickup, `released` with the order.
 */
export const ALLOCATION_STATUSES = ["active", "superseded", "consumed", "released"] as const;
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];

/**
 * Why an order's lots were (re)allocated: the order was `confirmed` (paid); an allocated lot is no
 * longer sellable (quarantine, expiry buffer, `lot_not_sellable`) or holds less than allocated
 * (`lot_short`); or stock came in for an order that was short (`stock_added`).
 */
export const ALLOCATION_CAUSES = [
  "confirmed",
  "lot_not_sellable",
  "lot_short",
  "stock_added",
] as const;
export type AllocationCause = (typeof ALLOCATION_CAUSES)[number];

/** Why a reservation was released: stock goes back to available. */
export const RELEASE_REASONS = [
  "checkout_cancelled",
  "order_cancelled",
  "refunded",
  "staff_correction",
] as const;
export type ReleaseReason = (typeof RELEASE_REASONS)[number];

/** Ali's decisions (2026-10-14): a hold lasts 15 minutes unless asked otherwise, at most 30. */
export const HOLD_DEFAULT_MINUTES = 15;
export const HOLD_MAX_MINUTES = 30;
export const MINUTE_MS = 60_000;

/** The most holds the expiry job marks in one run (it runs every minute and loops until none is left). */
export const EXPIRY_BATCH = 200;

/**
 * An opaque reference to whoever holds the reservation: `checkout:<uuidv7>` or `order:<uuidv7>`,
 * nothing else. It is stored for good and shown on the Stock page, so it can never carry a name, an
 * e-mail address or a national register number (igs-pharma#99 review). Enforced by Zod and by the
 * database check.
 */
export const HOLDER_REF_PATTERN =
  /^(checkout|order):[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** What is on the shelf, what is set aside, what is left to sell, and by how much it is short. */
export interface Availability {
  readonly onHand: number;
  /** On hand in lots that may be sold (ADR 0011): not quarantined, not `unknown`, not near expiry. */
  readonly sellable: number;
  /** Quantity in live holds (not yet past `expires_at`). */
  readonly held: number;
  /** Quantity in active orders. */
  readonly ordered: number;
  /** `sellable − held − ordered`, never below 0: what a new hold may take. */
  readonly available: number;
  /**
   * How many units the pharmacy is SHORT for its orders: the sellable stock is less than the orders
   * reserved (a count, an adjustment, a quarantine or the expiry buffer lowered it). 0 when not short.
   */
  readonly short: number;
}

/** The numbers above from the sums. `sellable` defaults to all of on-hand. Pure. */
export function availabilityOf(
  onHand: number,
  held: number,
  ordered: number,
  sellable: number = onHand,
): Availability {
  return {
    onHand,
    sellable,
    held,
    ordered,
    available: Math.max(0, sellable - held - ordered),
    short: Math.max(0, ordered - sellable),
  };
}

// ── lots (igs-pharma#164, ADR 0011) ──────────────────────────────────────────────────────────────

/**
 * How a lot is identified: `lot` (a lot number, and for a medicine an expiry date), `no_lot` (a
 * non-medicine received without one: a kind, never a lot-number string) or `unknown` (stock from
 * before lots existed whose lot was never recorded: never sellable).
 */
export const LOT_TRACKING = ["lot", "no_lot", "unknown"] as const;
export type LotTracking = (typeof LOT_TRACKING)[number];

/** Why a lot is quarantined (not sellable until a pharmacist releases it). */
export const QUARANTINE_REASONS = ["quality", "recall", "damaged", "other"] as const;
export type QuarantineReason = (typeof QUARANTINE_REASONS)[number];

/** A lot number as printed on the pack. */
export const LOT_NUMBER_MAX = 40;
export const LOT_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9./ -]{0,39}$/;

/** A lot stops selling this many days before its expiry date unless the titular changes it. */
export const EXPIRY_BUFFER_DEFAULT_DAYS = 30;
export const EXPIRY_BUFFER_MAX_DAYS = 365;

/** Where a lot stands against its expiry date: only `sellable` may be sold. */
export const EXPIRY_STATES = ["sellable", "within_expiry_buffer", "expired"] as const;
export type ExpiryState = (typeof EXPIRY_STATES)[number];

/** `YYYY-MM-DD` plus `days`, as a calendar date (no time zone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const at = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days));
  return at.toISOString().slice(0, 10);
}

/**
 * A lot's expiry state on `today` (a Brussels calendar date, `YYYY-MM-DD`): expired on and after its
 * expiry date; within the buffer while `expiry_date <= today + bufferDays`; sellable after that. A
 * lot without an expiry date (`no_lot`) is always `sellable` by date.
 */
export function expiryStateOf(
  expiryDate: string | null,
  today: string,
  bufferDays: number,
): ExpiryState {
  if (expiryDate === null) return "sellable";
  if (expiryDate <= today) return "expired";
  if (expiryDate <= addDays(today, bufferDays)) return "within_expiry_buffer";
  return "sellable";
}
