CREATE SCHEMA "privacy";
--> statement-breakpoint
CREATE TABLE "privacy"."consent_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_ref" text NOT NULL,
	"purpose" text NOT NULL,
	"granted" boolean NOT NULL,
	"policy_version" text NOT NULL,
	"source" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_events_purpose_check" CHECK (purpose IN ('marketing_email', 'analytics_cookies')),
	CONSTRAINT "consent_events_source_check" CHECK (source IN ('storefront', 'in_store', 'phone', 'back_office', 'import'))
);
--> statement-breakpoint
CREATE TABLE "privacy"."dsr_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dsr_events_to_status_check" CHECK (to_status IN ('received', 'in_progress', 'completed', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "privacy"."dsr_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_ref" text NOT NULL,
	"type" text NOT NULL,
	"channel" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dsr_requests_type_check" CHECK (type IN ('access', 'erasure', 'rectification', 'restriction', 'objection')),
	CONSTRAINT "dsr_requests_channel_check" CHECK (channel IN ('email', 'in_store', 'post', 'other')),
	CONSTRAINT "dsr_requests_status_check" CHECK (status IN ('received', 'in_progress', 'completed', 'rejected')),
	CONSTRAINT "dsr_requests_due_check" CHECK ("privacy"."dsr_requests"."due_at" > "privacy"."dsr_requests"."received_at")
);
--> statement-breakpoint
ALTER TABLE "privacy"."dsr_events" ADD CONSTRAINT "dsr_events_request_id_dsr_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "privacy"."dsr_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_events_subject_purpose_at_idx" ON "privacy"."consent_events" USING btree ("subject_ref","purpose","at");--> statement-breakpoint
CREATE INDEX "dsr_events_request_at_idx" ON "privacy"."dsr_events" USING btree ("request_id","at");--> statement-breakpoint
CREATE INDEX "dsr_requests_status_due_idx" ON "privacy"."dsr_requests" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "dsr_requests_subject_ref_idx" ON "privacy"."dsr_requests" USING btree ("subject_ref");