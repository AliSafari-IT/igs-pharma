-- igs-pharma#187: grants for the recalls and the stop-sales.

GRANT SELECT, INSERT, UPDATE ON "catalog"."stop_sales" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "inventory"."recalls" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT ON "inventory"."recall_lots" TO "igs_app";
