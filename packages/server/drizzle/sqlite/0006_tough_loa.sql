CREATE TABLE `overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`tool_pattern` text NOT NULL,
	`action` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_overrides_agent_id` ON `overrides` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_overrides_expires_at` ON `overrides` (`expires_at`);--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refresh_tokens_token_hash_unique` ON `refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_refresh_tokens_hash` ON `refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`oidc_sub` text NOT NULL,
	`email` text,
	`display_name` text,
	`role` text DEFAULT 'viewer' NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`created_at` integer NOT NULL,
	`disabled_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_oidc_sub_unique` ON `users` (`oidc_sub`);--> statement-breakpoint
CREATE INDEX `idx_users_sub` ON `users` (`oidc_sub`);