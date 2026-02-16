/**
 * Test setup module
 * 
 * This module creates and manages test database instances.
 * Each test file should import and use createTestApp() for isolation.
 */

import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "../db/schema.js";

// Combined SQL for all migrations (copy from drizzle migrations)
const MIGRATIONS_SQL = `
-- 0000_mute_carlie_cooper.sql
CREATE TABLE IF NOT EXISTS \`approval_requests\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`action\` text NOT NULL,
	\`params\` text,
	\`context\` text,
	\`status\` text NOT NULL,
	\`urgency\` text NOT NULL,
	\`created_at\` integer NOT NULL,
	\`updated_at\` integer NOT NULL,
	\`decided_at\` integer,
	\`decided_by\` text,
	\`decision_reason\` text,
	\`expires_at\` integer
);

CREATE TABLE IF NOT EXISTS \`audit_logs\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`request_id\` text NOT NULL,
	\`event_type\` text NOT NULL,
	\`actor\` text NOT NULL,
	\`details\` text,
	\`created_at\` integer NOT NULL,
	FOREIGN KEY (\`request_id\`) REFERENCES \`approval_requests\`(\`id\`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE IF NOT EXISTS \`policies\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`name\` text NOT NULL,
	\`rules\` text NOT NULL,
	\`priority\` integer NOT NULL,
	\`enabled\` integer NOT NULL,
	\`created_at\` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS \`api_keys\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`key_hash\` text NOT NULL,
	\`name\` text NOT NULL,
	\`scopes\` text NOT NULL,
	\`created_at\` integer NOT NULL,
	\`last_used_at\` integer,
	\`revoked_at\` integer,
	\`rate_limit\` integer
);

CREATE TABLE IF NOT EXISTS \`webhook_deliveries\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`webhook_id\` text NOT NULL,
	\`event\` text NOT NULL,
	\`payload\` text NOT NULL,
	\`status\` text NOT NULL,
	\`attempts\` integer DEFAULT 0 NOT NULL,
	\`last_attempt_at\` integer,
	\`response_code\` integer,
	\`response_body\` text,
	FOREIGN KEY (\`webhook_id\`) REFERENCES \`webhooks\`(\`id\`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE IF NOT EXISTS \`webhooks\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`url\` text NOT NULL,
	\`secret\` text NOT NULL,
	\`events\` text NOT NULL,
	\`created_at\` integer NOT NULL,
	\`enabled\` integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS \`decision_tokens\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`request_id\` text NOT NULL,
	\`action\` text NOT NULL,
	\`token\` text NOT NULL,
	\`expires_at\` integer NOT NULL,
	\`used_at\` integer,
	\`created_at\` integer NOT NULL,
	FOREIGN KEY (\`request_id\`) REFERENCES \`approval_requests\`(\`id\`) ON UPDATE no action ON DELETE no action
);
CREATE UNIQUE INDEX IF NOT EXISTS \`decision_tokens_token_unique\` ON \`decision_tokens\` (\`token\`);

CREATE TABLE IF NOT EXISTS \`overrides\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`agent_id\` text NOT NULL,
	\`tool_pattern\` text NOT NULL,
	\`action\` text NOT NULL,
	\`reason\` text,
	\`created_at\` integer NOT NULL,
	\`expires_at\` integer
);
CREATE INDEX IF NOT EXISTS \`idx_overrides_agent_id\` ON \`overrides\` (\`agent_id\`);
CREATE INDEX IF NOT EXISTS \`idx_overrides_expires_at\` ON \`overrides\` (\`expires_at\`);

CREATE TABLE IF NOT EXISTS \`users\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`oidc_sub\` text NOT NULL,
	\`email\` text,
	\`display_name\` text,
	\`role\` text DEFAULT 'viewer' NOT NULL,
	\`tenant_id\` text DEFAULT 'default' NOT NULL,
	\`created_at\` integer NOT NULL,
	\`disabled_at\` integer
);
CREATE UNIQUE INDEX IF NOT EXISTS \`users_oidc_sub_unique\` ON \`users\` (\`oidc_sub\`);
CREATE INDEX IF NOT EXISTS \`idx_users_sub\` ON \`users\` (\`oidc_sub\`);

CREATE TABLE IF NOT EXISTS \`refresh_tokens\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL,
	\`tenant_id\` text NOT NULL,
	\`token_hash\` text NOT NULL,
	\`expires_at\` integer NOT NULL,
	\`revoked_at\` integer,
	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE no action
);
CREATE UNIQUE INDEX IF NOT EXISTS \`refresh_tokens_token_hash_unique\` ON \`refresh_tokens\` (\`token_hash\`);
CREATE INDEX IF NOT EXISTS \`idx_refresh_tokens_hash\` ON \`refresh_tokens\` (\`token_hash\`);
`;

export type TestDb = BetterSQLite3Database<typeof schema>;

export interface TestContext {
  db: TestDb;
  sqlite: Database.Database;
  cleanup: () => void;
}

/**
 * Create an in-memory test database with all migrations applied
 */
export function createTestDb(): TestContext {
  const sqlite = new Database(":memory:");
  
  // Run migrations — strip SQL comments before splitting on semicolons
  const stripped = MIGRATIONS_SQL.replace(/--[^\n]*/g, "");
  for (const statement of stripped.split(";")) {
    const trimmed = statement.trim();
    if (trimmed) {
      sqlite.exec(trimmed);
    }
  }
  
  const db = drizzle(sqlite, { schema });
  
  return {
    db,
    sqlite,
    cleanup: () => sqlite.close(),
  };
}

/**
 * Create an API key directly in the database for testing
 */
export async function createTestApiKey(
  db: TestDb,
  options: {
    name?: string;
    scopes?: string[];
    revoked?: boolean;
  } = {}
): Promise<{ id: string; key: string; keyHash: string }> {
  const { createHash, randomBytes } = await import("node:crypto");
  const { nanoid } = await import("nanoid");
  
  const id = nanoid();
  const randomPart = randomBytes(32).toString("base64url");
  const key = `agk_${randomPart}`;
  const keyHash = createHash("sha256").update(key).digest("hex");
  
  await db.insert(schema.apiKeys).values({
    id,
    keyHash,
    name: options.name || "test-key",
    scopes: JSON.stringify(options.scopes || ["admin"]),
    createdAt: Math.floor(Date.now() / 1000),
    revokedAt: options.revoked ? Math.floor(Date.now() / 1000) : null,
  });
  
  return { id, key, keyHash };
}

/**
 * Create a test policy in the database
 */
export async function createTestPolicy(
  db: TestDb,
  options: {
    name?: string;
    rules?: schema.Policy["rules"];
    priority?: number;
    enabled?: boolean;
  } = {}
): Promise<schema.Policy> {
  const { nanoid } = await import("nanoid");
  
  const policy = {
    id: nanoid(),
    name: options.name || "test-policy",
    rules: options.rules || JSON.stringify([]),
    priority: options.priority ?? 100,
    enabled: options.enabled ?? true,
    createdAt: new Date(),
  };
  
  await db.insert(schema.policies).values(policy);
  
  return policy;
}
