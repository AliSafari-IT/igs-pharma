-- igs-pharma#116 (D-045): grants of the checkout tables. Contacts and checkout lines are insert-only; the
-- worker may only run the purge function.

GRANT SELECT, INSERT, UPDATE ON "orders"."reference_counters" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "orders"."checkouts" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT ON "orders"."checkout_lines" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT ON "orders"."order_contacts" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "orders"."payments" TO "igs_app";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "orders"."purge_expired_carts"() TO "igs_worker";
