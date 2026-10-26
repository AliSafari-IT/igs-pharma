ALTER TABLE "catalog"."products" ADD COLUMN "gtin" text;--> statement-breakpoint
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_gtin_unique" UNIQUE("gtin");--> statement-breakpoint
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_gtin_check" CHECK ("catalog"."products"."gtin" IS NULL OR "catalog"."products"."gtin" ~ '^[0-9]{14}$');