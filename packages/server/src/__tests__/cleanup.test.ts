/**
 * Tests for CI-005: Background Cleanup Job
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import * as schema from "../db/schema.js";

const { decisionTokens, approvalRequests, webhooks, webhookDeliveries } = schema;

// Create in-memory database
const sqlite = new Database(":memory:");
const db = drizzle(sqlite, { schema });

// Migrations
const MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS approval_requests (
  id text PRIMARY KEY NOT NULL,
  action text NOT NULL,
  params text,
  context text,
  status text NOT NULL,
  urgency text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  decided_at integer,
  decided_by text,
  decision_reason text,
  expires_at integer,
  verified_agent_id text
);

CREATE TABLE IF NOT EXISTS webhooks (
  id text PRIMARY KEY NOT NULL,
  url text NOT NULL,
  secret text NOT NULL,
  events text NOT NULL,
  created_at integer NOT NULL,
  enabled integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id text PRIMARY KEY NOT NULL,
  webhook_id text NOT NULL,
  event text NOT NULL,
  payload text NOT NULL,
  status text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  last_attempt_at integer,
  response_code integer,
  response_body text,
  FOREIGN KEY (webhook_id) REFERENCES webhooks(id)
);

CREATE TABLE IF NOT EXISTS decision_tokens (
  id text PRIMARY KEY NOT NULL,
  request_id text NOT NULL,
  action text NOT NULL,
  token text NOT NULL UNIQUE,
  expires_at integer NOT NULL,
  used_at integer,
  created_at integer NOT NULL,
  FOREIGN KEY (request_id) REFERENCES approval_requests(id)
);
`;

for (const stmt of MIGRATIONS_SQL.split(";")) {
  const t = stmt.trim();
  if (t) sqlite.exec(t);
}

// Mock dependencies
vi.mock("../db/index.js", () => ({
  getDb: () => db,
  decisionTokens: schema.decisionTokens,
  webhookDeliveries: schema.webhookDeliveries,
  webhooks: schema.webhooks,
}));

vi.mock("../config.js", () => ({
  getConfig: () => ({
    cleanupRetentionDays: 30,
    cleanupIntervalMs: 3_600_000,
  }),
}));

vi.mock("../lib/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

import { runCleanup } from "../lib/cleanup.js";

afterAll(() => sqlite.close());

describe("Cleanup Job", () => {
  beforeEach(() => {
    sqlite.exec("DELETE FROM webhook_deliveries");
    sqlite.exec("DELETE FROM decision_tokens");
    sqlite.exec("DELETE FROM webhooks");
    sqlite.exec("DELETE FROM approval_requests");
  });

  it("deletes expired tokens beyond retention, preserves active ones", async () => {
    const now = new Date();
    const reqId = nanoid();
    // Create a parent request
    await db.insert(approvalRequests).values({
      id: reqId,
      action: "test",
      status: "pending",
      urgency: "normal",
      createdAt: now,
      updatedAt: now,
    });

    // Expired token (expired 60 days ago — beyond 30-day retention)
    await db.insert(decisionTokens).values({
      id: nanoid(),
      requestId: reqId,
      action: "approve",
      token: nanoid(),
      expiresAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 61 * 24 * 60 * 60 * 1000),
    });

    // Active token (expires in the future)
    await db.insert(decisionTokens).values({
      id: nanoid(),
      requestId: reqId,
      action: "deny",
      token: nanoid(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdAt: now,
    });

    const result = await runCleanup();
    expect(result.deletedTokens).toBe(1);

    // Active token preserved
    const remaining = await db.select().from(decisionTokens);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].action).toBe("deny");
  });

  it("deletes orphaned webhook deliveries", async () => {
    // Create a webhook with a delivery
    const whId = nanoid();
    await db.insert(webhooks).values({
      id: whId,
      url: "https://example.com/hook",
      secret: "s",
      events: '["request.approved"]',
      createdAt: Math.floor(Date.now() / 1000),
      enabled: 1,
    });
    await db.insert(webhookDeliveries).values({
      id: nanoid(),
      webhookId: whId,
      event: "request.approved",
      payload: "{}",
      status: "success",
    });

    // Orphaned delivery (webhook doesn't exist) — must disable FK checks for test
    sqlite.exec("PRAGMA foreign_keys = OFF");
    await db.insert(webhookDeliveries).values({
      id: nanoid(),
      webhookId: "nonexistent",
      event: "request.denied",
      payload: "{}",
      status: "failed",
    });
    sqlite.exec("PRAGMA foreign_keys = ON");

    const result = await runCleanup();
    expect(result.deletedDeliveries).toBe(1);

    // Valid delivery preserved
    const remaining = await db.select().from(webhookDeliveries);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].webhookId).toBe(whId);
  });
});
