-- igs-pharma#116 (D-045): the orders schema's runtime grants. igs_app reads and writes carts, creates
-- and moves orders (no DELETE; triggers keep lines and history), and only reads the status history.

GRANT USAGE ON SCHEMA "orders" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "orders"."carts" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "orders"."cart_lines" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "orders"."orders" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT ON "orders"."order_lines" TO "igs_app";
--> statement-breakpoint
GRANT SELECT ON "orders"."order_events" TO "igs_app";
