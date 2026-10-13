-- Custom SQL migration file, put your code below! --

GRANT EXECUTE ON FUNCTION "inventory"."purge_expired_import_plans"() TO "igs_worker";
--> statement-breakpoint
GRANT SELECT ON "privacy"."retention_policy" TO "igs_app";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "privacy"."purge_expired_data"() TO "igs_worker";
