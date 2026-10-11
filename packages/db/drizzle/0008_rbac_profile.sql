CREATE TABLE "identity"."permissions" (
	"key" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."role_permissions" (
	"role_key" text NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permissions_role_key_permission_key_pk" PRIMARY KEY("role_key","permission_key")
);
--> statement-breakpoint
CREATE TABLE "identity"."roles" (
	"key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "roles_kind_check" CHECK (kind IN ('customer', 'staff'))
);
--> statement-breakpoint
CREATE TABLE "identity"."user_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"role_key" text NOT NULL,
	"location_id" uuid,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_role_location_unique" UNIQUE NULLS NOT DISTINCT("user_id","role_key","location_id")
);
--> statement-breakpoint
ALTER TABLE "identity"."users" ADD COLUMN "locale" text DEFAULT 'nl' NOT NULL;--> statement-breakpoint
ALTER TABLE "identity"."users" ADD COLUMN "kind" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "identity"."users" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "identity"."users" ADD COLUMN "identity_assurance" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "identity"."role_permissions" ADD CONSTRAINT "role_permissions_role_key_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "identity"."roles"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "identity"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user_roles" ADD CONSTRAINT "user_roles_role_key_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "identity"."roles"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user_roles" ADD CONSTRAINT "user_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_roles_user_id_idx" ON "identity"."user_roles" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "identity"."users" ADD CONSTRAINT "users_locale_check" CHECK (locale IN ('nl', 'fr', 'de', 'en'));--> statement-breakpoint
ALTER TABLE "identity"."users" ADD CONSTRAINT "users_kind_check" CHECK (kind IN ('customer', 'staff'));--> statement-breakpoint
ALTER TABLE "identity"."users" ADD CONSTRAINT "users_status_check" CHECK (status IN ('active', 'suspended', 'deleted'));--> statement-breakpoint
ALTER TABLE "identity"."users" ADD CONSTRAINT "users_identity_assurance_check" CHECK (identity_assurance IN ('none', 'email', 'itsme_high'));