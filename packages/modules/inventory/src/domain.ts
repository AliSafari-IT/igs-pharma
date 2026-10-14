/**
 * Inventory domain rules (igs-pharma#53, domain-model §4), free of I/O and of imports: drizzle-kit
 * loads this file through `schema.ts`.
 */

/** Belgian national product code: exactly 7 digits (the same rule as the catalog). */
const isValidCnk = (value: string): boolean => /^[0-9]{7}$/.test(value);

export const LOCATION_KINDS = ["pharmacy"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

/**
 * Why stock moved: a CSV count, a counted change (breakage, loss…), fixing an earlier mistake, or a
 * sale picked for an order (`sale`, written when a reservation is consumed, igs-pharma#99).
 */
export const MOVEMENT_REASONS = ["import", "adjustment", "correction", "sale"] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

/** The reasons staff pick in the Adjust dialog (`import` belongs to the CSV import). */
export const ADJUST_REASONS = ["adjustment", "correction"] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];

/**
 * The one location of v1, "Saint-Gilles pharmacy", seeded with this fixed id by migration
 * `inventory_v1_location`. Multi-location is a later slice; every v1 operation uses it.
 */
export const DEFAULT_LOCATION_ID = "0192f000-0000-7000-8000-000000000001";

export const MAX_IMPORT_ROWS = 5_000;
export const MAX_QUANTITY = 1_000_000;
/** How long a prepared import (a previewed file) can be confirmed. */
export const IMPORT_PLAN_TTL_MS = 60 * 60 * 1000;
/** The CSV import's size limit in characters (5 000 rows fit comfortably). */
export const MAX_IMPORT_CHARS = 256_000;

export interface StockCsvRow {
  /** 1-based line number in the file, for error messages. */
  readonly line: number;
  readonly cnk: string;
  readonly quantity: number;
}

/** A problem with the file: `line` 0 is the file as a whole. */
export interface StockCsvError {
  readonly line: number;
  readonly code: string;
}

export interface ParsedStockCsv {
  readonly rows: readonly StockCsvRow[];
  readonly errors: readonly StockCsvError[];
}

const HEADER = /^\s*cnk\s*[;,]\s*(quantity|qty|aantal|quantité)\s*$/i;

/** A field without one pair of surrounding double quotes (`""` inside stands for one `"`). */
const unquote = (field: string) =>
  /^".*"$/.test(field) ? field.slice(1, -1).replaceAll('""', '"').trim() : field;

/**
 * Parses a stock count file: one `cnk;quantity` per line (`,` also accepted when a line has no
 * `;`), an optional header line, blank lines and `#` comments ignored. Quantity is the absolute
 * count on hand. Every line is checked, so all problems are reported at once. Spreadsheet exports
 * are accepted as they come: Windows, Unix or old Mac line endings, a byte-order mark, and fields
 * in double quotes (`"5410000000017";"3"`, #91).
 */
export function parseStockCsv(text: string): ParsedStockCsv {
  const rows: StockCsvRow[] = [];
  const errors: StockCsvError[] = [];
  const seen = new Set<string>();
  const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  lines.forEach((raw, index) => {
    const line = index + 1;
    const content = raw.trim();
    if (content === "" || content.startsWith("#")) return;
    const parts = content.split(content.includes(";") ? ";" : ",").map((p) => unquote(p.trim()));
    if (rows.length === 0 && errors.length === 0 && HEADER.test(parts.join(";"))) return;
    if (parts.length !== 2) {
      errors.push({ line, code: "inventory.row_malformed" });
      return;
    }
    const [cnk = "", quantityText = ""] = parts;
    if (!isValidCnk(cnk)) {
      errors.push({ line, code: "inventory.cnk_invalid" });
      return;
    }
    const quantity = /^[0-9]{1,7}$/.test(quantityText) ? Number(quantityText) : Number.NaN;
    if (!Number.isInteger(quantity) || quantity > MAX_QUANTITY) {
      errors.push({ line, code: "inventory.quantity_invalid" });
      return;
    }
    if (seen.has(cnk)) {
      errors.push({ line, code: "inventory.duplicate_cnk" });
      return;
    }
    seen.add(cnk);
    rows.push({ line, cnk, quantity });
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
 * The four states and their arrows (the database forbids the others, migration 0037):
 * `active` → `released` | `consumed` | `expired`; a `hold` may become an `order` while it stays
 * `active`. Only a `hold` can expire; only an `order` can be consumed. The three end states are final.
 */
export const RESERVATION_STATUSES = ["active", "released", "consumed", "expired"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

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
 * An opaque reference to whoever holds the reservation (a future checkout or order id). It is not
 * personal data and must never be: letters, digits and `: _ . -` only (no `@`, no spaces).
 */
export const HOLDER_REF_PATTERN = /^[A-Za-z0-9:_.-]{1,100}$/;

/** What is on the shelf, what is set aside, what is left to sell, and by how much it is short. */
export interface Availability {
  readonly onHand: number;
  /** Quantity in live holds (not yet past `expires_at`). */
  readonly held: number;
  /** Quantity in active orders. */
  readonly ordered: number;
  /** `onHand − held − ordered`, never below 0: what a new hold may take. */
  readonly available: number;
  /**
   * How many units the pharmacy is SHORT for its orders: the shelf holds fewer than the orders
   * reserved (a count or an adjustment lowered it). 0 when it is not short.
   */
  readonly short: number;
}

/** The numbers above from the three sums. Pure. */
export function availabilityOf(onHand: number, held: number, ordered: number): Availability {
  return {
    onHand,
    held,
    ordered,
    available: Math.max(0, onHand - held - ordered),
    short: Math.max(0, ordered - onHand),
  };
}
