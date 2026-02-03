/**
 * Tests for the Audit Log API
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { eq, desc, and, gte, lte, sql, isNull, type SQL } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import * as schema from "../db/schema.js";

const { approvalRequests, auditLogs, apiKeys } = schema;

// -------------- Test Setup --------------

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
`;

for (const statement of MIGRATIONS_SQL.split(";")) {
  const trimmed = statement.trim();
  if (trimmed) {
    sqlite.exec(trimmed);
  }
}

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

async function validateApiKeyFromDb(key: string): Promise<schema.ApiKey | null> {
  const hash = hashApiKey(key);
  const results = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);
  
  return results[0] || null;
}

// -------------- Auth Middleware (inline for testing) --------------

type AuthVariables = { apiKey: schema.ApiKey };

async function authMiddleware(c: any, next: () => Promise<void>) {
  const authHeader = c.req.header("Authorization");
  
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }
  
  const key = authHeader.slice(7);
  const apiKeyRecord = await validateApiKeyFromDb(key);
  if (!apiKeyRecord) {
    return c.json({ error: "Invalid API key" }, 401);
  }
  
  c.set("apiKey", apiKeyRecord);
  await next();
}

// -------------- Create Test App with Audit Route --------------

function createTestApp() {
  const app = new Hono<{ Variables: AuthVariables }>();
  
  app.use("*", cors());
  app.use("/api/*", authMiddleware);
  
  // GET /api/audit - List audit entries with filters and pagination
  app.get("/api/audit", async (c) => {
    const action = c.req.query("action");
    const status = c.req.query("status");
    const eventType = c.req.query("eventType");
    const actor = c.req.query("actor");
    const from = c.req.query("from");
    const to = c.req.query("to");
    const requestId = c.req.query("requestId");
    const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
    const offset = parseInt(c.req.query("offset") || "0", 10);

    // Build conditions for audit logs
    const auditConditions: SQL[] = [];

    // Date filters
    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) {
        auditConditions.push(gte(auditLogs.createdAt, fromDate));
      }
    }

    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        auditConditions.push(lte(auditLogs.createdAt, toDate));
      }
    }

    // Event type filter
    const validEventTypes = ["created", "approved", "denied", "expired", "viewed"];
    if (eventType && validEventTypes.includes(eventType)) {
      auditConditions.push(
        eq(auditLogs.eventType, eventType as "created" | "approved" | "denied" | "expired" | "viewed")
      );
    }

    // Actor filter
    if (actor) {
      auditConditions.push(eq(auditLogs.actor, actor));
    }

    // Request ID filter
    if (requestId) {
      auditConditions.push(eq(auditLogs.requestId, requestId));
    }

    // For action and status filters, we need to join with approvalRequests
    const requestConditions: SQL[] = [];
    if (action) {
      requestConditions.push(eq(approvalRequests.action, action));
    }
    const validStatuses = ["pending", "approved", "denied", "expired"];
    if (status && validStatuses.includes(status)) {
      requestConditions.push(
        eq(approvalRequests.status, status as "pending" | "approved" | "denied" | "expired")
      );
    }

    // Build the query with join
    let whereClause: SQL | undefined;
    const allConditions = [...auditConditions, ...requestConditions];
    if (allConditions.length > 0) {
      whereClause = and(...allConditions);
    }

    // Execute query with join
    const query = db
      .select({
        audit: auditLogs,
        request: {
          id: approvalRequests.id,
          action: approvalRequests.action,
          status: approvalRequests.status,
          urgency: approvalRequests.urgency,
        },
      })
      .from(auditLogs)
      .leftJoin(approvalRequests, eq(auditLogs.requestId, approvalRequests.id))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);

    const results = whereClause 
      ? await query.where(whereClause)
      : await query;

    // Get total count
    const countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(auditLogs)
      .leftJoin(approvalRequests, eq(auditLogs.requestId, approvalRequests.id));

    const countResult = whereClause
      ? await countQuery.where(whereClause)
      : await countQuery;

    const total = countResult[0]?.count || 0;

    // Format response
    const entries = results.map((row) => ({
      id: row.audit.id,
      requestId: row.audit.requestId,
      eventType: row.audit.eventType,
      actor: row.audit.actor,
      details: row.audit.details ? JSON.parse(row.audit.details) : null,
      createdAt: row.audit.createdAt.toISOString(),
      request: row.request
        ? {
            id: row.request.id,
            action: row.request.action,
            status: row.request.status,
            urgency: row.request.urgency,
          }
        : null,
    }));

    return c.json({
      entries,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + results.length < total,
      },
    });
  });

  // GET /api/audit/actions - Get unique action values
  app.get("/api/audit/actions", async (c) => {
    const results = await db
      .selectDistinct({ action: approvalRequests.action })
      .from(approvalRequests)
      .orderBy(approvalRequests.action);

    return c.json({
      actions: results.map((r) => r.action),
    });
  });

  // GET /api/audit/actors - Get unique actor values
  app.get("/api/audit/actors", async (c) => {
    const results = await db
      .selectDistinct({ actor: auditLogs.actor })
      .from(auditLogs)
      .orderBy(auditLogs.actor);

    return c.json({
      actors: results.map((r) => r.actor),
    });
  });
  
  return app;
}

// -------------- Test Variables --------------

let app: ReturnType<typeof createTestApp>;
let adminKey: string;
let requestId1: string;
let requestId2: string;
let requestId3: string;

// -------------- Helper to create test data --------------

async function createTestRequest(action: string, status: string, urgency: string = "normal"): Promise<string> {
  const id = nanoid();
  const now = new Date();
  
  await db.insert(approvalRequests).values({
    id,
    action,
    params: JSON.stringify({}),
    context: JSON.stringify({}),
    status: status as any,
    urgency: urgency as any,
    createdAt: now,
    updatedAt: now,
    decidedAt: status !== "pending" ? now : null,
    decidedBy: status !== "pending" ? "admin" : null,
  });
  
  return id;
}

async function createTestAuditLog(
  requestId: string, 
  eventType: string, 
  actor: string,
  createdAt?: Date
): Promise<string> {
  const id = nanoid();
  
  await db.insert(auditLogs).values({
    id,
    requestId,
    eventType: eventType as any,
    actor,
    details: JSON.stringify({ test: true }),
    createdAt: createdAt || new Date(),
  });
  
  return id;
}

// -------------- Test Lifecycle --------------

beforeAll(async () => {
  app = createTestApp();
  
  // Create admin API key for tests
  const adminResult = await createApiKeyInDb("admin-test-key", ["admin"]);
  adminKey = adminResult.key;
});

beforeEach(async () => {
  // Clear test data
  await db.delete(auditLogs);
  await db.delete(approvalRequests);
  
  // Create test data
  requestId1 = await createTestRequest("file.read", "approved", "normal");
  requestId2 = await createTestRequest("file.delete", "denied", "high");
  requestId3 = await createTestRequest("system.update", "pending", "critical");
  
  // Create audit logs
  await createTestAuditLog(requestId1, "created", "system");
  await createTestAuditLog(requestId1, "approved", "admin");
  await createTestAuditLog(requestId2, "created", "system");
  await createTestAuditLog(requestId2, "denied", "policy");
  await createTestAuditLog(requestId3, "created", "system");
});

afterAll(() => {
  sqlite.close();
});

// -------------- Helper for requests --------------

function authHeader() {
  return { Authorization: `Bearer ${adminKey}` };
}

// -------------- Tests --------------

describe("Audit API", () => {
  describe("GET /api/audit", () => {
    it("should list all audit entries", async () => {
      const res = await app.request("/api/audit", {
        headers: authHeader(),
      });
      
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.entries).toBeDefined();
      expect(json.entries.length).toBe(5);
      expect(json.pagination).toBeDefined();
      expect(json.pagination.total).toBe(5);
    });
    
    it("should include request details with each entry", async () => {
      const res = await app.request("/api/audit", {
        headers: authHeader(),
      });
      
      expect(res.status).toBe(200);
      const json = await res.json();
      
      const entry = json.entries[0];
      expect(entry.id).toBeDefined();
      expect(entry.requestId).toBeDefined();
      expect(entry.eventType).toBeDefined();
      expect(entry.actor).toBeDefined();
      expect(entry.createdAt).toBeDefined();
      expect(entry.request).toBeDefined();
      expect(entry.request.action).toBeDefined();
      expect(entry.request.status).toBeDefined();
    });
    
    it("should filter by eventType", async () => {
      const res = await app.request("/api/audit?eventType=approved", {
        headers: authHeader(),
      });
      
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.entries.every((e: any) => e.eventType === "approved")).toBe(true);
      expect(json.entries.length).toBe(1);
    });
    
    it("should filter by status (via request status)", async () => {
      const res = await app.request("/api/audit?status=denied", {
        headers: authHeader(),
      });
      
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.entries.every((e: any) => e.request.status === "denied")).toBe(true);
      expect(json.entries.length).toBe(2); // created + denied events for denied request
    });
    
    it("should filter by action", async () => {
      const res = await app.request("/api/audit?action=file.read", {
        headers: authHeader(),
      });
      
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.entries.every((e: any) => e.request.action === "file.read")).toBe(true);
      expect(json.entries.length).toBe(2); // created + approved events
    });
    
    it("should filter by actor", async () => {
      const res = await app.request("/api/audit?actor=policy", {
        headers: authHeader(),
      });
      
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.entries.every((e: any) => e.actor === "policy")).toBe(true);
      expect(json.entries.length).toBe(1);
    });
    
    it("should filter by requestId", async () => {
      const res = await app.request(`/api/audit?requestId=${requestId1}`, {
        headers: authHeader(),
      });
      
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.entries.every((e: any) => e.requestId === requestId1)).toBe(true);
      expect(json.entries.length).toBe(2);
    });
    
    it("should filter by date range", async () => {
      // Create an old audit log entry
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      await createTestAuditLog(requestId1, "viewed", "user", yesterday);
      
      const today = new Date().toISOString().split("T")[0];
      const res = await app.request(`/api/audit?from=${today}`, {
        headers: authHeader(),
      });
      
      expect(res.status).toBe(200);
      const json = await res.json();
      // Should exclude the old entry
      expect(json.entries.length).toBe(5);
    });
    
    it("should support pagination with limit and offset", async () => {
      const res = await app.request("/api/audit?limit=2&offset=0", {
        headers: authHeader(),
      });
      
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.entries.length).toBe(2);
      expect(json.pagination.total).toBe(5);
      expect(json.pagination.limit).toBe(2);
      expect(json.pagination.offset).toBe(0);
      expect(json.pagination.hasMore).toBe(true);
    });
    
    it("should return hasMore=false on last page", async () => {
      const res = await app.request("/api/audit?limit=10&offset=0", {
        headers: authHeader(),
      });
      
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.pagination.hasMore).toBe(false);
    });
    
    it("should limit max results to 100", async () => {
      const res = await app.request("/api/audit?limit=500", {
        headers: authHeader(),
      });
      
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.pagination.limit).toBe(100);
    });
    
    it("should combine multiple filters", async () => {
      const res = await app.request("/api/audit?eventType=created&status=pending", {
        headers: authHeader(),
      });
      
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.entries.length).toBe(1);
      expect(json.entries[0].eventType).toBe("created");
      expect(json.entries[0].request.status).toBe("pending");
    });
    
    it("should order results by createdAt descending", async () => {
      const res = await app.request("/api/audit", {
        headers: authHeader(),
      });
      
      expect(res.status).toBe(200);
      const json = await res.json();
      
      // Verify descending order
      for (let i = 1; i < json.entries.length; i++) {
        const prev = new Date(json.entries[i - 1].createdAt);
        const curr = new Date(json.entries[i].createdAt);
        expect(prev.getTime()).toBeGreaterThanOrEqual(curr.getTime());
      }
    });
  });
  
  describe("GET /api/audit/actions", () => {
    it("should return unique action values", async () => {
      const res = await app.request("/api/audit/actions", {
        headers: authHeader(),
      });
      
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.actions).toBeDefined();
      expect(json.actions).toContain("file.read");
      expect(json.actions).toContain("file.delete");
      expect(json.actions).toContain("system.update");
      expect(json.actions.length).toBe(3);
    });
    
    it("should return sorted actions", async () => {
      const res = await app.request("/api/audit/actions", {
        headers: authHeader(),
      });
      
      expect(res.status).toBe(200);
      const json = await res.json();
      const sorted = [...json.actions].sort();
      expect(json.actions).toEqual(sorted);
    });
  });
  
  describe("GET /api/audit/actors", () => {
    it("should return unique actor values", async () => {
      const res = await app.request("/api/audit/actors", {
        headers: authHeader(),
      });
      
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.actors).toBeDefined();
      expect(json.actors).toContain("system");
      expect(json.actors).toContain("admin");
      expect(json.actors).toContain("policy");
    });
    
    it("should return sorted actors", async () => {
      const res = await app.request("/api/audit/actors", {
        headers: authHeader(),
      });
      
      expect(res.status).toBe(200);
      const json = await res.json();
      const sorted = [...json.actors].sort();
      expect(json.actors).toEqual(sorted);
    });
  });
  
  describe("Authentication", () => {
    it("should reject requests without auth", async () => {
      const res = await app.request("/api/audit");
      expect(res.status).toBe(401);
    });
    
    it("should reject requests with invalid auth", async () => {
      const res = await app.request("/api/audit", {
        headers: { Authorization: "Bearer invalid" },
      });
      expect(res.status).toBe(401);
    });
  });
});
