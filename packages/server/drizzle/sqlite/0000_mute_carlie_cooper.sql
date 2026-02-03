CREATE TABLE `approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`params` text,
	`context` text,
	`status` text NOT NULL,
	`urgency` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`decided_at` integer,
	`decided_by` text,
	`decision_reason` text,
	`expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`event_type` text NOT NULL,
	`actor` text NOT NULL,
	`details` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `approval_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `policies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`rules` text NOT NULL,
	`priority` integer NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL
);
