CREATE TABLE "overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"tool_pattern" text NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" integer NOT NULL,
	"revoked_at" integer,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"oidc_sub" text NOT NULL,
	"email" text,
	"display_name" text,
	"role" text DEFAULT 'viewer' NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"created_at" integer NOT NULL,
	"disabled_at" integer,
	CONSTRAINT "users_oidc_sub_unique" UNIQUE("oidc_sub")
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_overrides_agent_id" ON "overrides" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_overrides_expires_at" ON "overrides" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_hash" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_users_sub" ON "users" USING btree ("oidc_sub");