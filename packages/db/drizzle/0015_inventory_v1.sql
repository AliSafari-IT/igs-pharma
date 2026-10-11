CREATE SCHEMA "inventory";
--> statement-breakpoint
CREATE TABLE "inventory"."locations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_kind_check" CHECK (kind IN ('pharmacy'))
);
--> statement-breakpoint
CREATE TABLE "inventory"."stock_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"import_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_delta_check" CHECK ("inventory"."stock_movements"."delta" <> 0),
	CONSTRAINT "stock_movements_reason_check" CHECK (reason IN ('import', 'adjustment', 'correction'))
);
--> statement-breakpoint
ALTER TABLE "inventory"."stock_movements" ADD CONSTRAINT "stock_movements_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "inventory"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_product_location_at_idx" ON "inventory"."stock_movements" USING btree ("product_id","location_id","at");--> statement-breakpoint
CREATE INDEX "stock_movements_import_id_idx" ON "inventory"."stock_movements" USING btree ("import_id");