import { newId } from "@igs/db/ids";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { CURRENCY, MAX_AMOUNT_CENTS, PRICE_CHANNELS } from "./domain";

/**
 * Pricing module tables (igs-pharma#59, domain-model §3). Owned by this module (D-001), Postgres
 * schema `pricing`; UUIDv7 ids generated app-side (D-003); timestamptz everywhere.
 *
 * `prices` is append-only (a trigger in migration `pricing_append_only` refuses UPDATE, DELETE and
 * TRUNCATE): a price change is a new row, so the table is its own history. The current price is the
 * latest row with `valid_from <= now`; a row with a later `valid_from` is a scheduled change.
 * `amount_cents` includes VAT. `product_id` is a catalog product id without a foreign key: a module
 * never references another module's tables (module-anatomy rule 2).
 */
export const pricing = pgSchema("pricing");

const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(", ")})`);

export const prices = pricing.table(
  "prices",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => newId()),
    productId: uuid("product_id").notNull(),
    channel: text("channel").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default(CURRENCY),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    /** Free text written by staff; never copied into the audit trail. */
    reason: text("reason"),
    createdByType: text("created_by_type").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("prices_channel_check", oneOf("channel", PRICE_CHANNELS)),
    check(
      "prices_amount_cents_check",
      sql`${t.amountCents} > 0 AND ${t.amountCents} <= ${sql.raw(String(MAX_AMOUNT_CENTS))}`,
    ),
    check("prices_currency_check", sql`${t.currency} = ${sql.raw(`'${CURRENCY}'`)}`),
    index("prices_product_channel_valid_from_idx").on(t.productId, t.channel, t.validFrom),
  ],
);

/**
 * VAT rates by class over time, in basis points (600 = 6 %). The rate of a class at a moment is the
 * row with the latest `valid_from` before it; `BE_6` and `BE_21` are seeded by the migration.
 */
export const vatClasses = pricing.table(
  "vat_classes",
  {
    code: text("code").notNull(),
    rateBp: integer("rate_bp").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.code, t.validFrom] }),
    check("vat_classes_rate_bp_check", sql`${t.rateBp} >= 0 AND ${t.rateBp} < 10000`),
  ],
);
