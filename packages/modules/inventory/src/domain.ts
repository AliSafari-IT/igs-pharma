/**
 * Inventory domain rules (igs-pharma#53, domain-model §4), free of I/O and of imports: drizzle-kit
 * loads this file through `schema.ts`.
 */

/** Belgian national product code: exactly 7 digits (the same rule as the catalog). */
const isValidCnk = (value: string): boolean => /^[0-9]{7}$/.test(value);

export const LOCATION_KINDS = ["pharmacy"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

/** Why stock moved: a CSV count, a counted change (breakage, loss…), or fixing an earlier mistake. */
export const MOVEMENT_REASONS = ["import", "adjustment", "correction"] as const;
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

/**
 * Parses a stock count file: one `cnk;quantity` per line (`,` also accepted when a line has no
 * `;`), an optional header line, blank lines and `#` comments ignored. Quantity is the absolute
 * count on hand. Every line is checked, so all problems are reported at once.
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
    if (rows.length === 0 && errors.length === 0 && HEADER.test(content)) return;
    const parts = content.split(content.includes(";") ? ";" : ",").map((p) => p.trim());
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
