-- igs-pharma#166: grants for the reconciliations.

GRANT SELECT, INSERT, UPDATE ON "inventory"."reconciliations" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT ON "inventory"."reconciliation_lines" TO "igs_app";
