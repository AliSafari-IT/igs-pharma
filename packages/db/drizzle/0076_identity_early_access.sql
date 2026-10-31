-- igs-pharma#199: early access to the gated storefront (requests and grants), and the end date an
-- early-access approval mail states.
CREATE TABLE "identity"."early_access_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"invited_email" "citext",
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "early_access_requests_status_check" CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
	CONSTRAINT "early_access_requests_subject_check" CHECK (user_id IS NOT NULL OR invited_email IS NOT NULL),
	CONSTRAINT "early_access_requests_note_length" CHECK (char_length(note) <= 500),
	CONSTRAINT "early_access_requests_reason_length" CHECK (char_length(decision_reason) <= 500),
	CONSTRAINT "early_access_requests_decision_check" CHECK ((status = 'pending') = (decided_at IS NULL))
);
--> statement-breakpoint
ALTER TABLE "identity"."mail_tokens" DROP CONSTRAINT "mail_tokens_template_check";--> statement-breakpoint
ALTER TABLE "identity"."mail_tokens" ADD COLUMN "valid_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "identity"."early_access_requests" ADD CONSTRAINT "early_access_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."early_access_requests" ADD CONSTRAINT "early_access_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "early_access_requests_one_pending" ON "identity"."early_access_requests" USING btree ("user_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "early_access_requests_user_id_idx" ON "identity"."early_access_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "early_access_requests_status_idx" ON "identity"."early_access_requests" USING btree ("status","requested_at");--> statement-breakpoint
ALTER TABLE "identity"."mail_tokens" ADD CONSTRAINT "mail_tokens_template_check" CHECK (template IN ('verify_email', 'reset_password', 'account_exists', 'early_access_received', 'early_access_approved', 'early_access_rejected', 'early_access_revoked', 'early_access_staff_notice'));