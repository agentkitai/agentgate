ALTER TABLE `agents` ADD `ingest_key_hash` text;--> statement-breakpoint
CREATE INDEX `idx_agents_ingest_key` ON `agents` (`ingest_key_hash`);