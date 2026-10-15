-- Custom SQL migration file, put your code below! --

GRANT SELECT, INSERT, UPDATE, DELETE ON "identity"."rate_limits" TO "igs_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "identity"."mail_tokens" TO "igs_app";
