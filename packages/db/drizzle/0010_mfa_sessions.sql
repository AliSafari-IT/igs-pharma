ALTER TABLE "identity"."roles" DROP CONSTRAINT "roles_kind_check";--> statement-breakpoint
ALTER TABLE "identity"."sessions" ADD COLUMN "mfa_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "identity"."roles" ADD CONSTRAINT "roles_kind_check" CHECK (kind IN ('customer', 'staff', 'system'));