import { newId } from "@igs/db/ids";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import {
  CONTENT_LOCALES,
  CONTENT_SOURCES,
  LEGAL_STATUSES,
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  VAT_CLASSES,
} from "./domain";

/**
 * Catalog module tables (igs-pharma#50, domain-model §2). Owned by this module (D-001), Postgres
 * schema `catalog`; UUIDv7 ids generated app-side (D-003); timestamptz everywhere. v1 holds
 * products, their per-locale content and brands; categories, media, substances and attributes are
 * later slices. Enumerations are text + CHECK (as in identity), not pg enums: cheaper to evolve.
 *
 * `product_content.approved_by` is a user id without a foreign key: a module never references
 * another module's tables (module-anatomy rule 2).
 */
export const catalog = pgSchema("catalog");

const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => newId());

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(", ")})`);

export const brands = catalog.table("brands", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: createdAt(),
});

export const products = catalog.table(
  "products",
  {
    id: id(),
    /** Belgian national product code: exactly 7 digits (also checked in the domain). */
    cnk: text("cnk").notNull().unique(),
    productType: text("product_type").notNull(),
    legalStatus: text("legal_status").notNull(),
    status: text("status").notNull().default("draft"),
    vatClass: text("vat_class").notNull(),
    requiresPharmacistReview: boolean("requires_pharmacist_review").notNull().default(false),
    ageMin: integer("age_min"),
    coldChain: boolean("cold_chain").notNull().default(false),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("products_cnk_check", sql`${t.cnk} ~ '^[0-9]{7}$'`),
    check("products_product_type_check", oneOf("product_type", PRODUCT_TYPES)),
    check("products_legal_status_check", oneOf("legal_status", LEGAL_STATUSES)),
    check("products_status_check", oneOf("status", PRODUCT_STATUSES)),
    check("products_vat_class_check", oneOf("vat_class", VAT_CLASSES)),
    check("products_age_min_check", sql`${t.ageMin} IS NULL OR ${t.ageMin} BETWEEN 0 AND 120`),
    index("products_brand_id_idx").on(t.brandId),
    index("products_status_idx").on(t.status),
  ],
);

export const productContent = catalog.table(
  "product_content",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    name: text("name").notNull(),
    shortDescription: text("short_description"),
    description: text("description"),
    warnings: text("warnings"),
    source: text("source").notNull().default("manual"),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.locale] }),
    check("product_content_locale_check", oneOf("locale", CONTENT_LOCALES)),
    check("product_content_source_check", oneOf("source", CONTENT_SOURCES)),
  ],
);
