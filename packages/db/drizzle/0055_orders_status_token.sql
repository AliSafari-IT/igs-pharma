-- igs-pharma#116: orders.status_token_hash (status link).
ALTER TABLE "orders"."orders" ADD COLUMN "status_token_hash" text;