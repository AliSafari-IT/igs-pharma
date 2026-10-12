CREATE SCHEMA "pricing";
--> statement-breakpoint
CREATE TABLE "pricing"."prices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"reason" text,
	"created_by_type" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prices_channel_check" CHECK (channel IN ('web', 'store', 'b2b')),
	CONSTRAINT "prices_amount_cents_check" CHECK ("pricing"."prices"."amount_cents" > 0 AND "pricing"."prices"."amount_cents" <= 10000000),
	CONSTRAINT "prices_currency_check" CHECK ("pricing"."prices"."currency" = 'EUR')
);
--> statement-breakpoint
CREATE TABLE "pricing"."vat_classes" (
	"code" text NOT NULL,
	"rate_bp" integer NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	CONSTRAINT "vat_classes_code_valid_from_pk" PRIMARY KEY("code","valid_from"),
	CONSTRAINT "vat_classes_rate_bp_check" CHECK ("pricing"."vat_classes"."rate_bp" >= 0 AND "pricing"."vat_classes"."rate_bp" < 10000)
);
--> statement-breakpoint
CREATE INDEX "prices_product_channel_valid_from_idx" ON "pricing"."prices" USING btree ("product_id","channel","valid_from");