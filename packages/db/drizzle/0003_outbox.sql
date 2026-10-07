CREATE TABLE "system"."outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"schema_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dead_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "system"."outbox" USING btree ("next_attempt_at") WHERE "system"."outbox"."published_at" IS NULL AND "system"."outbox"."dead_at" IS NULL;