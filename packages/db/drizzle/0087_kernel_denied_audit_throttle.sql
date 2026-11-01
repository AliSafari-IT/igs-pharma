-- igs-pharma#210: the kernel's denied-audit throttle (one audited refusal per actor, operation and minute).
CREATE TABLE "system"."denied_audit_throttle" (
	"actor_id" text NOT NULL,
	"operation" text NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	CONSTRAINT "denied_audit_throttle_actor_id_operation_minute_pk" PRIMARY KEY("actor_id","operation","minute")
);
--> statement-breakpoint
CREATE INDEX "denied_audit_throttle_minute_idx" ON "system"."denied_audit_throttle" USING btree ("minute");