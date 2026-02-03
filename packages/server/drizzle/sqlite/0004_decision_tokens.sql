CREATE TABLE `decision_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`action` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `approval_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decision_tokens_token_unique` ON `decision_tokens` (`token`);