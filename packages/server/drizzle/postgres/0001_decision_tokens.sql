CREATE TABLE "decision_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"action" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "decision_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "decision_tokens" ADD CONSTRAINT "decision_tokens_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;