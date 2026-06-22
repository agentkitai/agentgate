ALTER TABLE "policies" ADD COLUMN "scope" text DEFAULT 'global' NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "agent_ids" text;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "tool_ids" text;