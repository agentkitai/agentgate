ALTER TABLE "agents" ADD COLUMN "ingest_key_hash" text;--> statement-breakpoint
CREATE INDEX "idx_agents_ingest_key" ON "agents" USING btree ("ingest_key_hash");