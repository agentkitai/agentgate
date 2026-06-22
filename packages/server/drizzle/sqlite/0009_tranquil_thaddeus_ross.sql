ALTER TABLE `policies` ADD `scope` text DEFAULT 'global' NOT NULL;--> statement-breakpoint
ALTER TABLE `policies` ADD `agent_ids` text;--> statement-breakpoint
ALTER TABLE `policies` ADD `tool_ids` text;