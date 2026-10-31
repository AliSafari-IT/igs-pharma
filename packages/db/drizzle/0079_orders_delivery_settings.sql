CREATE TABLE "orders"."delivery_settings" (
	"key" text PRIMARY KEY DEFAULT 'delivery' NOT NULL,
	"price_cents" integer NOT NULL,
	"free_from_cents" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_type" text NOT NULL,
	"updated_by_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_settings_key_check" CHECK ("orders"."delivery_settings"."key" = 'delivery'),
	CONSTRAINT "delivery_settings_price_check" CHECK (price_cents >= 0 AND price_cents <= 5000),
	CONSTRAINT "delivery_settings_free_from_check" CHECK (free_from_cents IS NULL OR (free_from_cents >= 0 AND free_from_cents <= 100000)),
	CONSTRAINT "delivery_settings_version_check" CHECK ("orders"."delivery_settings"."version" >= 1)
);
