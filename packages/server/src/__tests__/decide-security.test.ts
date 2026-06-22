/**
 * Security tests for the decide endpoint
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { randomBytes } from "node:crypto";
import * as schema from "../db/schema.js";

const { approvalRequests, decisionTokens } = schema;

// Create in-memory database
const sqlite = new Database(":memory:");
const db = drizzle(sqlite, { schema });

// Run migrations
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

for (const statement of MIGRATIONS_SQL.split(";")) {
  const trimmed = statement.trim();
  if (trimmed) {
    sqlite.exec(trimmed);
  }
}

afterAll(() => {
  sqlite.close();
});

// Mock dependencies
vi.mock("../db/index.js", () => ({
  db,
  getDb: () => db,
  approvalRequests: schema.approvalRequests,
  decisionTokens: schema.decisionTokens,
}));

vi.mock("../lib/audit.js", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/webhook.js", () => ({
  deliverWebhook: vi.fn().mockResolvedValue(undefined),
}));

// Import the actual router after mocks are set up
const { default: decideRouter } = await import("../routes/decide.js");

// Create test app with the actual router
function createTestApp() {
  const app = new Hono();
  app.route("/api/decide", decideRouter);
  return app;
}

async function createPendingRequest(): Promise<string> {
  const id = nanoid();
  const now = new Date();

  await db.insert(approvalRequests).values({
    id,
    action: "test-action",
    params: JSON.stringify({ test: "data" }),
    context: JSON.stringify({}),
    status: "pending",
    urgency: "normal",
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

async function createToken(requestId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  await db.insert(decisionTokens).values({
    id: nanoid(),
    requestId,
    action: "approve",
    token,
    expiresAt,
    createdAt: now,
  });

  return token;
}

describe("Decide Endpoint Security", () => {
  let app: Hono;

  beforeEach(async () => {
    sqlite.exec("DELETE FROM decision_tokens");
    sqlite.exec("DELETE FROM approval_requests");
    app = createTestApp();
  });

  describe("Referrer-Policy header", () => {
    it("should set Referrer-Policy: no-referrer on invalid token response", async () => {
      const res = await app.request("/api/decide/invalid-token");

      expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    });

    it("should set Referrer-Policy: no-referrer on valid token response", async () => {
      const requestId = await createPendingRequest();
      const token = await createToken(requestId);

      const res = await app.request(`/api/decide/${token}`);

      expect(res.status).toBe(200);
      expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    });

    it("should set Referrer-Policy: no-referrer on expired token response", async () => {
      const requestId = await createPendingRequest();
      const token = randomBytes(32).toString("base64url");
      const pastDate = new Date(Date.now() - 1000 * 60 * 60);

      await db.insert(decisionTokens).values({
        id: nanoid(),
        requestId,
        action: "approve",
        token,
        expiresAt: pastDate,
        createdAt: new Date(),
      });

      const res = await app.request(`/api/decide/${token}`);

      expect(res.status).toBe(400);
      expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    });

    it("should include no-referrer meta tag in HTML response", async () => {
      const res = await app.request("/api/decide/invalid-token");
      const html = await res.text();

      expect(html).toContain('<meta name="referrer" content="no-referrer" />');
    });
  });
});
