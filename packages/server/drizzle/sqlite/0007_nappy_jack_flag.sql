CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`secret_hash` text NOT NULL,
	`status` text NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	`last_seen_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_agents_status` ON `agents` (`status`);--> statement-breakpoint
CREATE TABLE `escalation_history` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`escalated_at` integer NOT NULL,
	`from_channel` text,
	`to_channel` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_escalation_history_request_id` ON `escalation_history` (`request_id`);--> statement-breakpoint
CREATE INDEX `idx_escalation_history_rule_id` ON `escalation_history` (`rule_id`);--> statement-breakpoint
CREATE TABLE `escalation_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`policy_id` text,
	`trigger_after_sec` integer DEFAULT 1800 NOT NULL,
	`escalate_to` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_escalation_rules_policy_id` ON `escalation_rules` (`policy_id`);--> statement-breakpoint
ALTER TABLE `approval_requests` ADD `verified_agent_id` text;