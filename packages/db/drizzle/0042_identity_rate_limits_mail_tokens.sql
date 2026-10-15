CREATE TABLE "identity"."mail_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"template" text NOT NULL,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mail_tokens_template_check" CHECK (template IN ('verify_email', 'reset_password', 'account_exists'))
);
--> statement-breakpoint
CREATE TABLE "identity"."rate_limits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "identity"."mail_tokens" ADD CONSTRAINT "mail_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_tokens_user_id_idx" ON "identity"."mail_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mail_tokens_expires_at_idx" ON "identity"."mail_tokens" USING btree ("expires_at");