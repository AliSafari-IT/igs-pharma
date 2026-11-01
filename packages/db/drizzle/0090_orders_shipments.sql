-- igs-pharma#202 (milestone 5.3, part 3): the shipping states of a home-delivery order, the shipped
-- mail, and the parcel of each delivery order (orders.shipments). The guards are in 0091.
CREATE TABLE "orders"."shipments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text DEFAULT 'sendcloud' NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"provider_parcel_id" text,
	"tracking_number" text,
	"tracking_url" text,
	"carrier" text,
	"failure_code" text,
	"version" integer DEFAULT 1 NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"label_created_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_provider_check" CHECK (provider IN ('sendcloud')),
	CONSTRAINT "shipments_status_check" CHECK (status IN ('requested', 'created', 'failed', 'cancel_requested', 'cancelled')),
	CONSTRAINT "shipments_parcel_id_check" CHECK ("orders"."shipments"."provider_parcel_id" IS NULL OR "orders"."shipments"."provider_parcel_id" ~ '^[0-9]{1,20}$'),
	CONSTRAINT "shipments_tracking_check" CHECK (("orders"."shipments"."tracking_number" IS NULL OR char_length("orders"."shipments"."tracking_number") BETWEEN 1 AND 64)
        AND ("orders"."shipments"."tracking_url" IS NULL OR ("orders"."shipments"."tracking_url" ~ '^https://' AND char_length("orders"."shipments"."tracking_url") <= 500))
        AND ("orders"."shipments"."carrier" IS NULL OR char_length("orders"."shipments"."carrier") BETWEEN 1 AND 40)),
	CONSTRAINT "shipments_created_check" CHECK ("orders"."shipments"."status" <> 'created' OR ("orders"."shipments"."provider_parcel_id" IS NOT NULL AND "orders"."shipments"."tracking_number" IS NOT NULL AND "orders"."shipments"."label_created_at" IS NOT NULL)),
	CONSTRAINT "shipments_failure_check" CHECK (("orders"."shipments"."status" = 'failed') = ("orders"."shipments"."failure_code" IS NOT NULL) AND ("orders"."shipments"."failure_code" IS NULL OR "orders"."shipments"."failure_code" ~ '^[a-z0-9_]{1,40}$')),
	CONSTRAINT "shipments_version_check" CHECK ("orders"."shipments"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "orders"."order_events" DROP CONSTRAINT "order_events_from_status_check";--> statement-breakpoint
ALTER TABLE "orders"."order_events" DROP CONSTRAINT "order_events_to_status_check";--> statement-breakpoint
ALTER TABLE "orders"."order_mails" DROP CONSTRAINT "order_mails_kind_check";--> statement-breakpoint
ALTER TABLE "orders"."orders" DROP CONSTRAINT "orders_status_check";--> statement-breakpoint
ALTER TABLE "orders"."shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_order_idx" ON "orders"."shipments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "shipments_status_updated_idx" ON "orders"."shipments" USING btree ("status","updated_at");--> statement-breakpoint
ALTER TABLE "orders"."order_events" ADD CONSTRAINT "order_events_from_status_check" CHECK ("orders"."order_events"."from_status" IS NULL OR from_status IN ('pending_payment', 'paid_stock_short', 'in_review', 'ready_to_prepare', 'preparing', 'ready_for_pickup', 'collected', 'ready_to_ship', 'shipped', 'delivered', 'returned', 'cancelled', 'expired'));--> statement-breakpoint
ALTER TABLE "orders"."order_events" ADD CONSTRAINT "order_events_to_status_check" CHECK (to_status IN ('pending_payment', 'paid_stock_short', 'in_review', 'ready_to_prepare', 'preparing', 'ready_for_pickup', 'collected', 'ready_to_ship', 'shipped', 'delivered', 'returned', 'cancelled', 'expired'));--> statement-breakpoint
ALTER TABLE "orders"."order_mails" ADD CONSTRAINT "order_mails_kind_check" CHECK (kind IN ('order_received', 'stock_short', 'ready_for_pickup', 'shipped', 'refund_initiated', 'refund_completed', 'recall_notice'));--> statement-breakpoint
ALTER TABLE "orders"."orders" ADD CONSTRAINT "orders_status_check" CHECK (status IN ('pending_payment', 'paid_stock_short', 'in_review', 'ready_to_prepare', 'preparing', 'ready_for_pickup', 'collected', 'ready_to_ship', 'shipped', 'delivered', 'returned', 'cancelled', 'expired'));