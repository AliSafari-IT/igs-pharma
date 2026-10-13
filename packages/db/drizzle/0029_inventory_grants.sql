-- Custom SQL migration file, put your code below! --

GRANT SELECT ON "inventory"."stock_levels" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT ON "inventory"."import_plans" TO "igs_app";
