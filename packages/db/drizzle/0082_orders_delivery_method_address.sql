CREATE TABLE "orders"."order_addresses" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"street" text NOT NULL,
	"postal_code" text NOT NULL,
	"city" text NOT NULL,
	"country" text DEFAULT 'BE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_addresses_street_check" CHECK (char_length("orders"."order_addresses"."street") BETWEEN 1 AND 120),
	CONSTRAINT "order_addresses_postal_code_check" CHECK ("orders"."order_addresses"."postal_code" ~ '^[1-9][0-9]{3}$'),
	CONSTRAINT "order_addresses_city_check" CHECK (char_length("orders"."order_addresses"."city") BETWEEN 1 AND 80),
	CONSTRAINT "order_addresses_country_check" CHECK ("orders"."order_addresses"."country" = 'BE')
);
--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD COLUMN "delivery_method" text DEFAULT 'pickup' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD COLUMN "delivery_fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD COLUMN "delivery_vat_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."order_addresses" ADD CONSTRAINT "order_addresses_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD CONSTRAINT "orders_delivery_method_check" CHECK (delivery_method IN ('pickup', 'delivery'));--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD CONSTRAINT "orders_delivery_amounts_check" CHECK ("orders"."orders"."delivery_fee_cents" >= 0 AND "orders"."orders"."delivery_vat_cents" >= 0
        AND "orders"."orders"."delivery_vat_cents" <= "orders"."orders"."delivery_fee_cents"
        AND ("orders"."orders"."delivery_method" = 'delivery' OR ("orders"."orders"."delivery_fee_cents" = 0 AND "orders"."orders"."delivery_vat_cents" = 0))
        AND "orders"."orders"."delivery_fee_cents" <= "orders"."orders"."total_cents");