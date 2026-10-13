ALTER TABLE "catalog"."categories" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog"."products" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog"."categories" ADD CONSTRAINT "categories_version_check" CHECK ("catalog"."categories"."version" >= 1);--> statement-breakpoint
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_version_check" CHECK ("catalog"."products"."version" >= 1);