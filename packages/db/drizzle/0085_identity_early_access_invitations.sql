-- igs-pharma#211: early access by invitation: one open invitation per address, and mails to an
-- address with no account yet (an invitation).
ALTER TABLE "identity"."mail_tokens" DROP CONSTRAINT "mail_tokens_template_check";--> statement-breakpoint
ALTER TABLE "identity"."mail_tokens" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "identity"."mail_tokens" ADD COLUMN "to_email" "citext";--> statement-breakpoint
ALTER TABLE "identity"."mail_tokens" ADD COLUMN "locale" text;--> statement-breakpoint
CREATE UNIQUE INDEX "early_access_requests_one_invitation" ON "identity"."early_access_requests" USING btree (lower("invited_email")) WHERE user_id IS NULL AND status IN ('pending', 'approved');--> statement-breakpoint
ALTER TABLE "identity"."mail_tokens" ADD CONSTRAINT "mail_tokens_recipient_check" CHECK ((user_id IS NOT NULL AND to_email IS NULL AND locale IS NULL) OR (user_id IS NULL AND to_email IS NOT NULL AND locale IS NOT NULL));--> statement-breakpoint
ALTER TABLE "identity"."mail_tokens" ADD CONSTRAINT "mail_tokens_locale_check" CHECK (locale IN ('nl', 'fr', 'de', 'en'));--> statement-breakpoint
ALTER TABLE "identity"."mail_tokens" ADD CONSTRAINT "mail_tokens_template_check" CHECK (template IN ('verify_email', 'reset_password', 'account_exists', 'early_access_received', 'early_access_approved', 'early_access_rejected', 'early_access_revoked', 'early_access_staff_notice', 'early_access_invited'));