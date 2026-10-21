-- igs-pharma#164: grants for the lots, lot levels and inventory settings.

GRANT SELECT, INSERT, UPDATE ON "inventory"."lots" TO "igs_app";
--> statement-breakpoint
GRANT SELECT ON "inventory"."lot_levels" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, UPDATE ON "inventory"."settings" TO "igs_app";
