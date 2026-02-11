/**
 * Tests for decision tokens - one-click approve/deny links
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { eq, and, isNull } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import * as schema from "../db/schema.js";

const { approvalRequests, apiKeys, decisionTokens } = schema;

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
  expires_at integer
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY NOT NULL,
  request_id text NOT NULL,
  event_type text NOT NULL,
  actor text NOT NULL,
  details text,
  created_at integer NOT NULL,
  FOREIGN KEY (request_id) REFERENCES approval_requests(id)
);

CREATE TABLE IF NOT EXISTS policies (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  rules text NOT NULL,
  priority integer NOT NULL,
  enabled integer NOT NULL,
  created_at integer NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id text PRIMARY KEY NOT NULL,
  key_hash text NOT NULL,
  name text NOT NULL,
  scopes text NOT NULL,
  created_at integer NOT NULL,
  last_used_at integer,
  revoked_at integer,
  rate_limit integer
);

CREATE TABLE IF NOT EXISTS webhooks (
  id text PRIMARY KEY NOT NULL,
  url text NOT NULL,
  secret text NOT NULL,
  events text NOT NULL,
  created_at integer NOT NULL,
  enabled integer DEFAULT 1 NOT NULL
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

for (const statement of MIGRATIONS_SQL.split(";")) {
  const trimmed = statement.trim();
  if (trimmed) {
    sqlite.exec(trimmed);
  }
}

afterAll(() => {
  sqlite.close();
});

// -------------- Helper Functions --------------

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

async function createApiKeyInDb(name: string, scopes: string[]): Promise<{ id: string; key: string }> {
  const id = nanoid();
  const randomPart = randomBytes(32).toString("base64url");
  const key = `agk_${randomPart}`;
  const keyHash = hashApiKey(key);
  
  await db.insert(apiKeys).values({
    id,
    keyHash,
    name,
    scopes: JSON.stringify(scopes),
    createdAt: Math.floor(Date.now() / 1000),
  });
  
  return { id, key };
}

async function createPendingRequest(action = "test-action"): Promise<string> {
  const id = nanoid();
  const now = new Date();
  
  await db.insert(approvalRequests).values({
    id,
    action,
    params: JSON.stringify({ test: "data" }),
    context: JSON.stringify({}),
    status: "pending",
    urgency: "normal",
    createdAt: now,
    updatedAt: now,
  });
  
  return id;
}

// -------------- Mock App Setup --------------

function createTestApp() {
  const app = new Hono();

  // Decision endpoint (public, no auth required) - must be defined before auth middleware
  app.get("/api/decide/:token", async (c) => {
    const { token } = c.req.param();
    const now = new Date();

    const tokenResult = await db.select().from(decisionTokens).where(eq(decisionTokens.token, token)).limit(1);
    if (tokenResult.length === 0) {
      return c.html("<h1>Invalid Token</h1>", 404);
    }

    const tokenRecord = tokenResult[0]!;

    if (tokenRecord.usedAt) {
      return c.html("<h1>Already Used</h1>", 400);
    }

    if (tokenRecord.expiresAt < now) {
      return c.html("<h1>Link Expired</h1>", 400);
    }

    const requestResult = await db.select().from(approvalRequests).where(eq(approvalRequests.id, tokenRecord.requestId)).limit(1);
    if (requestResult.length === 0) {
      return c.html("<h1>Request Not Found</h1>", 404);
    }

    const request = requestResult[0]!;
    if (request.status !== "pending") {
      return c.html("<h1>Already Decided</h1>", 400);
    }

    const decision = tokenRecord.action === "approve" ? "approved" : "denied";

    // Mark token as used and cross-invalidate sibling tokens atomically
    await db.update(decisionTokens).set({ usedAt: now }).where(
      and(
        eq(decisionTokens.requestId, tokenRecord.requestId),
        isNull(decisionTokens.usedAt)
      )
    );

    // Update request
    await db.update(approvalRequests).set({
      status: decision,
      decidedAt: now,
      decidedBy: "token",
      decisionReason: `Decision made via one-click ${tokenRecord.action} link`,
      updatedAt: now,
    }).where(eq(approvalRequests.id, request.id));

    return c.html(`<h1>Request ${decision === "approved" ? "Approved" : "Denied"}</h1>`);
  });

  // Simple auth middleware for tests (applies to all other /api/* routes)
  app.use("/api/*", async (c, next) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const key = authHeader.slice(7);
    const hash = hashApiKey(key);
    const results = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash)).limit(1);
    if (!results[0]) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  });

  // POST /api/requests/:id/tokens - Generate token pair
  app.post("/api/requests/:id/tokens", async (c) => {
    const { id } = c.req.param();
    const expiryHours = 24;

    const existing = await db.select().from(approvalRequests).where(eq(approvalRequests.id, id)).limit(1);
    if (existing.length === 0) {
      return c.json({ error: "Request not found" }, 404);
    }

    const request = existing[0]!;
    if (request.status !== "pending") {
      return c.json({ error: `Request is not pending (current status: ${request.status})` }, 400);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiryHours * 60 * 60 * 1000);

    const approveToken = randomBytes(32).toString("base64url");
    const denyToken = randomBytes(32).toString("base64url");

    await db.insert(decisionTokens).values([
      {
        id: nanoid(),
        requestId: id,
        action: "approve",
        token: approveToken,
        expiresAt,
        createdAt: now,
      },
      {
        id: nanoid(),
        requestId: id,
        action: "deny",
        token: denyToken,
        expiresAt,
        createdAt: now,
      },
    ]);

    return c.json({
      requestId: id,
      tokens: {
        approve: { token: approveToken, url: `http://localhost:3000/api/decide/${approveToken}` },
        deny: { token: denyToken, url: `http://localhost:3000/api/decide/${denyToken}` },
      },
      expiresAt: expiresAt.toISOString(),
      expiresInHours: expiryHours,
    });
  });

  return app;
}

// -------------- Tests --------------

describe("Decision Tokens", () => {
  let app: Hono;
  let apiKey: string;

  beforeEach(async () => {
    // Clear tables
    sqlite.exec("DELETE FROM decision_tokens");
    sqlite.exec("DELETE FROM approval_requests");
    sqlite.exec("DELETE FROM api_keys");

    app = createTestApp();
    const keyData = await createApiKeyInDb("test-key", ["admin"]);
    apiKey = keyData.key;
  });

  describe("POST /api/requests/:id/tokens", () => {
    it("should generate approve and deny token pair", async () => {
      const requestId = await createPendingRequest();

      const res = await app.request(`/api/requests/${requestId}/tokens`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.requestId).toBe(requestId);
      expect(data.tokens.approve.token).toBeTruthy();
      expect(data.tokens.deny.token).toBeTruthy();
      expect(data.tokens.approve.url).toContain(data.tokens.approve.token);
      expect(data.tokens.deny.url).toContain(data.tokens.deny.token);
      expect(data.expiresInHours).toBe(24);
    });

    it("should return 404 for non-existent request", async () => {
      const res = await app.request("/api/requests/non-existent/tokens", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      expect(res.status).toBe(404);
    });

    it("should return 400 for non-pending request", async () => {
      const requestId = await createPendingRequest();
      
      // Mark as approved
      await db.update(approvalRequests).set({ status: "approved" }).where(eq(approvalRequests.id, requestId));

      const res = await app.request(`/api/requests/${requestId}/tokens`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("not pending");
    });

    it("should require authentication", async () => {
      const requestId = await createPendingRequest();

      const res = await app.request(`/api/requests/${requestId}/tokens`, {
        method: "POST",
      });

      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/decide/:token", () => {
    it("should approve request with valid approve token", async () => {
      const requestId = await createPendingRequest();
      
      // Generate tokens
      const tokenRes = await app.request(`/api/requests/${requestId}/tokens`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const tokenData = await tokenRes.json();
      const approveToken = tokenData.tokens.approve.token;

      // Use approve token
      const res = await app.request(`/api/decide/${approveToken}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Approved");

      // Verify request status
      const updated = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId)).limit(1);
      expect(updated[0]!.status).toBe("approved");
      expect(updated[0]!.decidedBy).toBe("token");
    });

    it("should deny request with valid deny token", async () => {
      const requestId = await createPendingRequest();
      
      // Generate tokens
      const tokenRes = await app.request(`/api/requests/${requestId}/tokens`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const tokenData = await tokenRes.json();
      const denyToken = tokenData.tokens.deny.token;

      // Use deny token
      const res = await app.request(`/api/decide/${denyToken}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Denied");

      // Verify request status
      const updated = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId)).limit(1);
      expect(updated[0]!.status).toBe("denied");
    });

    it("should reject invalid token", async () => {
      const res = await app.request("/api/decide/invalid-token");
      expect(res.status).toBe(404);
      const html = await res.text();
      expect(html).toContain("Invalid Token");
    });

    it("should reject already used token (single-use)", async () => {
      const requestId = await createPendingRequest();
      
      // Generate tokens
      const tokenRes = await app.request(`/api/requests/${requestId}/tokens`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const tokenData = await tokenRes.json();
      const approveToken = tokenData.tokens.approve.token;

      // Use token first time
      const res1 = await app.request(`/api/decide/${approveToken}`);
      expect(res1.status).toBe(200);

      // Try to use token again
      const res2 = await app.request(`/api/decide/${approveToken}`);
      expect(res2.status).toBe(400);
      const html = await res2.text();
      expect(html).toContain("Already Used");
    });

    it("should reject expired token", async () => {
      const requestId = await createPendingRequest();
      
      // Create an expired token directly
      const expiredToken = randomBytes(32).toString("base64url");
      const pastDate = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago

      await db.insert(decisionTokens).values({
        id: nanoid(),
        requestId,
        action: "approve",
        token: expiredToken,
        expiresAt: pastDate,
        createdAt: new Date(),
      });

      const res = await app.request(`/api/decide/${expiredToken}`);
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Expired");
    });

    it("should reject sibling token as Already Used after cross-invalidation (AC3)", async () => {
      const requestId = await createPendingRequest();
      
      // Generate tokens
      const tokenRes = await app.request(`/api/requests/${requestId}/tokens`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const tokenData = await tokenRes.json();
      const approveToken = tokenData.tokens.approve.token;
      const denyToken = tokenData.tokens.deny.token;

      // Approve using first token
      await app.request(`/api/decide/${approveToken}`);

      // Try to deny using second token — should be "Already Used" not "Already Decided"
      const res = await app.request(`/api/decide/${denyToken}`);
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Already Used");
    });

    it("should cross-invalidate deny token when approve token is used (AC1)", async () => {
      const requestId = await createPendingRequest();
      
      const tokenRes = await app.request(`/api/requests/${requestId}/tokens`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const tokenData = await tokenRes.json();

      // Use approve token
      await app.request(`/api/decide/${tokenData.tokens.approve.token}`);

      // Verify deny token has usedAt set in DB
      const denyTokenRecords = await db.select().from(decisionTokens)
        .where(and(eq(decisionTokens.requestId, requestId), eq(decisionTokens.action, "deny")))
        .limit(1);
      expect(denyTokenRecords[0]!.usedAt).not.toBeNull();
    });

    it("should cross-invalidate approve token when deny token is used (AC2)", async () => {
      const requestId = await createPendingRequest();
      
      const tokenRes = await app.request(`/api/requests/${requestId}/tokens`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const tokenData = await tokenRes.json();

      // Use deny token
      await app.request(`/api/decide/${tokenData.tokens.deny.token}`);

      // Verify approve token has usedAt set in DB
      const approveTokenRecords = await db.select().from(decisionTokens)
        .where(and(eq(decisionTokens.requestId, requestId), eq(decisionTokens.action, "approve")))
        .limit(1);
      expect(approveTokenRecords[0]!.usedAt).not.toBeNull();
    });

    it("should not require authentication (public endpoint)", async () => {
      const requestId = await createPendingRequest();
      
      // Generate tokens (with auth)
      const tokenRes = await app.request(`/api/requests/${requestId}/tokens`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const tokenData = await tokenRes.json();

      // Use token without auth
      const res = await app.request(`/api/decide/${tokenData.tokens.approve.token}`);
      expect(res.status).toBe(200);
    });
  });
});
