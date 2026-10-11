CREATE SCHEMA "catalog";
--> statement-breakpoint
CREATE TABLE "catalog"."brands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "catalog"."product_content" (
	"product_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	"short_description" text,
	"description" text,
	"warnings" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_content_product_id_locale_pk" PRIMARY KEY("product_id","locale"),
	CONSTRAINT "product_content_locale_check" CHECK (locale IN ('nl', 'fr', 'de', 'en')),
	CONSTRAINT "product_content_source_check" CHECK (source IN ('manual', 'medipim', 'sam'))
);
--> statement-breakpoint
CREATE TABLE "catalog"."products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cnk" text NOT NULL,
	"product_type" text NOT NULL,
	"legal_status" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"vat_class" text NOT NULL,
	"requires_pharmacist_review" boolean DEFAULT false NOT NULL,
	"age_min" integer,
	"cold_chain" boolean DEFAULT false NOT NULL,
	"brand_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_cnk_unique" UNIQUE("cnk"),
	CONSTRAINT "products_cnk_check" CHECK ("catalog"."products"."cnk" ~ '^[0-9]{7}$'),
	CONSTRAINT "products_product_type_check" CHECK (product_type IN ('otc_medicine', 'rx_medicine', 'medical_device', 'food_supplement', 'cosmetic', 'biocide', 'general')),
	CONSTRAINT "products_legal_status_check" CHECK (legal_status IN ('otc', 'rx', 'pharmacy_only', 'general_sale')),
	CONSTRAINT "products_status_check" CHECK (status IN ('draft', 'active', 'archived')),
	CONSTRAINT "products_vat_class_check" CHECK (vat_class IN ('BE_6', 'BE_21')),
	CONSTRAINT "products_age_min_check" CHECK ("catalog"."products"."age_min" IS NULL OR "catalog"."products"."age_min" BETWEEN 0 AND 120)
);
--> statement-breakpoint
ALTER TABLE "catalog"."product_content" ADD CONSTRAINT "product_content_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "catalog"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_brand_id_idx" ON "catalog"."products" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "catalog"."products" USING btree ("status");