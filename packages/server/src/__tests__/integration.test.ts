/**
 * Integration tests for AgentGate server
 * 
 * These tests use an in-memory SQLite database to test all API endpoints.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { eq, desc, and, sql, isNull } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import * as schema from "../db/schema.js";
import type { PolicyRule, ApprovalRequest as CoreApprovalRequest, Policy as CorePolicy } from "@agentgate/core";
import { evaluatePolicy } from "@agentgate/core";

// Schema imports
const { approvalRequests, auditLogs, policies, apiKeys, webhooks, webhookDeliveries } = schema;

// -------------- Test Setup --------------

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

async function createApiKeyInDb(name: string, scopes: string[], rateLimit: number | null = null): Promise<{ id: string; key: string }> {
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
    rateLimit,
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
  
  const apiKey = results[0];
  if (!apiKey) return null;
  
  // Update last_used_at
  await db.update(apiKeys)
    .set({ lastUsedAt: Math.floor(Date.now() / 1000) })
    .where(eq(apiKeys.id, apiKey.id));
  
  return apiKey;
}

// -------------- Rate Limiter (inline for testing) --------------

interface RateLimitEntry {
  timestamps: number[];
}

const testRateLimitStore = new Map<string, RateLimitEntry>();
const WINDOW_MS = 60 * 1000;

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
}

function checkRateLimit(apiKeyId: string, limit: number | null): RateLimitResult {
  if (limit === null || limit <= 0) {
    return { allowed: true, limit: 0, remaining: 0, resetMs: 0 };
  }
  
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  
  let entry = testRateLimitStore.get(apiKeyId);
  if (!entry) {
    entry = { timestamps: [] };
    testRateLimitStore.set(apiKeyId, entry);
  }
  
  entry.timestamps = entry.timestamps.filter(ts => ts > windowStart);
  
  const count = entry.timestamps.length;
  const remaining = Math.max(0, limit - count);
  const resetMs = entry.timestamps.length > 0 
    ? Math.max(0, entry.timestamps[0]! + WINDOW_MS - now)
    : WINDOW_MS;
  
  if (count >= limit) {
    return { allowed: false, limit, remaining: 0, resetMs };
  }
  
  entry.timestamps.push(now);
  return { allowed: true, limit, remaining: remaining - 1, resetMs };
}

function clearTestRateLimits() {
  testRateLimitStore.clear();
}

// -------------- Auth Middleware (inline for testing) --------------

type AuthVariables = { apiKey: schema.ApiKey; rateLimit: RateLimitResult | null };

function setRateLimitHeaders(c: any, result: RateLimitResult): void {
  if (result.limit > 0) {
    c.header("X-RateLimit-Limit", result.limit.toString());
    c.header("X-RateLimit-Remaining", result.remaining.toString());
    c.header("X-RateLimit-Reset", Math.ceil(Date.now() / 1000 + result.resetMs / 1000).toString());
  }
}

async function authMiddleware(c: any, next: () => Promise<void>) {
  const authHeader = c.req.header("Authorization");
  
  if (!authHeader) {
    return c.json({ error: "Missing Authorization header" }, 401);
  }
  
  if (!authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Invalid Authorization format" }, 401);
  }
  
  const key = authHeader.slice(7);
  if (!key) {
    return c.json({ error: "Invalid Authorization format" }, 401);
  }
  
  const apiKeyRecord = await validateApiKeyFromDb(key);
  if (!apiKeyRecord) {
    return c.json({ error: "Invalid API key" }, 401);
  }
  
  // Check rate limit
  const rateLimitResult = checkRateLimit(apiKeyRecord.id, apiKeyRecord.rateLimit);
  
  if (!rateLimitResult.allowed) {
    setRateLimitHeaders(c, rateLimitResult);
    c.header("Retry-After", Math.ceil(rateLimitResult.resetMs / 1000).toString());
    return c.json({ error: "Rate limit exceeded" }, 429);
  }
  
  c.set("apiKey", apiKeyRecord);
  c.set("rateLimit", rateLimitResult);
  await next();
  
  // Set rate limit headers on successful responses
  if (rateLimitResult.limit > 0) {
    setRateLimitHeaders(c, rateLimitResult);
  }
}

function requireScope(scope: string) {
  return async (c: any, next: () => Promise<void>) => {
    const apiKey = c.get("apiKey") as schema.ApiKey;
    const scopes = JSON.parse(apiKey.scopes) as string[];
    
    if (!scopes.includes(scope) && !scopes.includes("admin")) {
      return c.json({ error: `Missing required scope: ${scope}` }, 403);
    }
    
    await next();
  };
}

// -------------- Audit Logging (inline) --------------

async function logAuditEvent(
  requestId: string,
  eventType: "created" | "approved" | "denied" | "expired" | "viewed",
  actor: string,
  details?: Record<string, unknown>
) {
  await db.insert(auditLogs).values({
    id: nanoid(),
    requestId,
    eventType,
    actor,
    details: details ? JSON.stringify(details) : null,
    createdAt: new Date(),
  });
}

// -------------- Create Test App --------------

function createTestApp() {
  const app = new Hono<{ Variables: AuthVariables }>();
  
  app.use("*", cors());
  
  // Health check (no auth)
  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });
  
  // Apply auth middleware to /api/*
  app.use("/api/*", authMiddleware);
  
  // -------------- Requests Routes --------------
  
  app.post("/api/requests", async (c) => {
    const body = await c.req.json();
    
    if (!body || typeof body.action !== "string" || !body.action.trim()) {
      return c.json({ error: "action is required and must be a non-empty string" }, 400);
    }
    
    const action = body.action.trim();
    const params = body.params && typeof body.params === "object" ? body.params : {};
    const context = body.context && typeof body.context === "object" ? body.context : {};
    const validUrgencies = ["low", "normal", "high", "critical"];
    const urgency = validUrgencies.includes(body.urgency) ? body.urgency : "normal";
    
    let expiresAt: Date | undefined;
    if (body.expiresAt) {
      const parsed = new Date(body.expiresAt);
      if (!isNaN(parsed.getTime())) {
        expiresAt = parsed;
      }
    }
    
    const id = nanoid();
    const now = new Date();
    
    // Load policies
    const allPolicies = await db.select().from(policies).orderBy(policies.priority);
    const corePolicies: CorePolicy[] = allPolicies.map((p) => ({
      id: p.id,
      name: p.name,
      rules: JSON.parse(p.rules) as PolicyRule[],
      priority: p.priority,
      enabled: p.enabled,
    }));
    
    // Build request for policy evaluation
    const requestForEval: CoreApprovalRequest = {
      id,
      action,
      params,
      context,
      status: "pending",
      urgency,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    };
    
    // Run policy engine
    const policyDecision = evaluatePolicy(requestForEval, corePolicies);
    
    // Determine status
    let status: "pending" | "approved" | "denied" = "pending";
    let decidedBy: string | null = null;
    let decidedAt: Date | null = null;
    let decisionReason: string | null = null;
    
    if (policyDecision.decision === "auto_approve") {
      status = "approved";
      decidedBy = "policy";
      decidedAt = now;
      decisionReason = `Auto-approved by policy`;
    } else if (policyDecision.decision === "auto_deny") {
      status = "denied";
      decidedBy = "policy";
      decidedAt = now;
      decisionReason = `Auto-denied by policy`;
    }
    
    await db.insert(approvalRequests).values({
      id,
      action,
      params: JSON.stringify(params),
      context: JSON.stringify(context),
      status,
      urgency,
      createdAt: now,
      updatedAt: now,
      decidedAt,
      decidedBy,
      decisionReason,
      expiresAt,
    });
    
    await logAuditEvent(id, "created", "system", { action, params, context, urgency });
    
    if (status === "approved") {
      await logAuditEvent(id, "approved", "policy", { reason: decisionReason, automatic: true });
    } else if (status === "denied") {
      await logAuditEvent(id, "denied", "policy", { reason: decisionReason, automatic: true });
    }
    
    return c.json({
      id,
      action,
      params,
      context,
      status,
      urgency,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      decidedAt: decidedAt?.toISOString() || null,
      decidedBy,
      decisionReason,
      expiresAt: expiresAt?.toISOString() || null,
      policyDecision: {
        decision: policyDecision.decision,
        approvers: policyDecision.approvers,
        channels: policyDecision.channels,
      },
    }, 201);
  });
  
  app.get("/api/requests/:id", async (c) => {
    const id = c.req.param("id");
    const result = await db.select().from(approvalRequests).where(eq(approvalRequests.id, id)).limit(1);
    
    if (result.length === 0) {
      return c.json({ error: "Request not found" }, 404);
    }
    
    const row = result[0]!;
    return c.json({
      id: row.id,
      action: row.action,
      params: row.params ? JSON.parse(row.params) : {},
      context: row.context ? JSON.parse(row.context) : {},
      status: row.status,
      urgency: row.urgency,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() || null,
      decidedBy: row.decidedBy,
      decisionReason: row.decisionReason,
      expiresAt: row.expiresAt?.toISOString() || null,
    });
  });
  
  app.get("/api/requests", async (c) => {
    const statusFilter = c.req.query("status");
    const actionFilter = c.req.query("action");
    const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
    const offset = parseInt(c.req.query("offset") || "0", 10);
    
    const conditions: any[] = [];
    if (statusFilter && ["pending", "approved", "denied", "expired"].includes(statusFilter)) {
      conditions.push(eq(approvalRequests.status, statusFilter as any));
    }
    if (actionFilter) {
      conditions.push(eq(approvalRequests.action, actionFilter));
    }
    
    let query = db.select().from(approvalRequests);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }
    
    const results = await query.orderBy(desc(approvalRequests.createdAt)).limit(limit).offset(offset);
    
    let countQuery = db.select({ count: sql<number>`count(*)` }).from(approvalRequests);
    if (conditions.length > 0) {
      countQuery = countQuery.where(and(...conditions)) as any;
    }
    const countResult = await countQuery;
    const total = countResult[0]?.count || 0;
    
    return c.json({
      requests: results.map(row => ({
        id: row.id,
        action: row.action,
        params: row.params ? JSON.parse(row.params) : {},
        context: row.context ? JSON.parse(row.context) : {},
        status: row.status,
        urgency: row.urgency,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        decidedAt: row.decidedAt?.toISOString() || null,
        decidedBy: row.decidedBy,
        decisionReason: row.decisionReason,
        expiresAt: row.expiresAt?.toISOString() || null,
      })),
      pagination: { total, limit, offset, hasMore: offset + results.length < total },
    });
  });
  
  app.post("/api/requests/:id/decide", async (c) => {
    const id = c.req.param("id");
    
    const existing = await db.select().from(approvalRequests).where(eq(approvalRequests.id, id)).limit(1);
    if (existing.length === 0) {
      return c.json({ error: "Request not found" }, 404);
    }
    
    const existingRequest = existing[0]!;
    if (existingRequest.status !== "pending") {
      return c.json({ error: `Request is not pending (current status: ${existingRequest.status})` }, 400);
    }
    
    const body = await c.req.json();
    
    if (!["approved", "denied"].includes(body.decision)) {
      return c.json({ error: "decision must be 'approved' or 'denied'" }, 400);
    }
    if (typeof body.decidedBy !== "string" || !body.decidedBy.trim()) {
      return c.json({ error: "decidedBy is required and must be a non-empty string" }, 400);
    }
    
    const decision = body.decision as "approved" | "denied";
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    const decidedBy = body.decidedBy.trim();
    const now = new Date();
    
    await db.update(approvalRequests)
      .set({
        status: decision,
        decidedAt: now,
        decidedBy,
        decisionReason: reason || null,
        updatedAt: now,
      })
      .where(eq(approvalRequests.id, id));
    
    await logAuditEvent(id, decision === "approved" ? "approved" : "denied", decidedBy, { reason, automatic: false });
    
    const updated = await db.select().from(approvalRequests).where(eq(approvalRequests.id, id)).limit(1);
    const row = updated[0]!;
    
    return c.json({
      id: row.id,
      action: row.action,
      params: row.params ? JSON.parse(row.params) : {},
      context: row.context ? JSON.parse(row.context) : {},
      status: row.status,
      urgency: row.urgency,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() || null,
      decidedBy: row.decidedBy,
      decisionReason: row.decisionReason,
      expiresAt: row.expiresAt?.toISOString() || null,
    });
  });
  
  app.get("/api/requests/:id/audit", async (c) => {
    const id = c.req.param("id");
    
    const existing = await db.select().from(approvalRequests).where(eq(approvalRequests.id, id)).limit(1);
    if (existing.length === 0) {
      return c.json({ error: "Request not found" }, 404);
    }
    
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.requestId, id)).orderBy(auditLogs.createdAt);
    
    return c.json(logs.map(log => ({
      id: log.id,
      requestId: log.requestId,
      eventType: log.eventType,
      actor: log.actor,
      details: log.details ? JSON.parse(log.details) : null,
      createdAt: log.createdAt.toISOString(),
    })));
  });
  
  // -------------- Policies Routes --------------
  
  app.get("/api/policies", async (c) => {
    const allPolicies = await db.select().from(policies).orderBy(policies.priority);
    return c.json(allPolicies.map(p => ({
      ...p,
      rules: JSON.parse(p.rules),
    })));
  });
  
  app.post("/api/policies", async (c) => {
    const body = await c.req.json();
    
    if (typeof body.name !== "string" || !body.name.trim()) {
      return c.json({ error: "name is required and must be a non-empty string" }, 400);
    }
    if (!Array.isArray(body.rules)) {
      return c.json({ error: "rules is required and must be an array" }, 400);
    }
    
    for (let i = 0; i < body.rules.length; i++) {
      const rule = body.rules[i];
      if (!rule || typeof rule !== "object") {
        return c.json({ error: `rules[${i}] must be an object` }, 400);
      }
      if (!rule.match || typeof rule.match !== "object") {
        return c.json({ error: `rules[${i}].match is required and must be an object` }, 400);
      }
      if (!["auto_approve", "auto_deny", "route_to_human", "route_to_agent"].includes(rule.decision)) {
        return c.json({ error: `rules[${i}].decision must be one of: auto_approve, auto_deny, route_to_human, route_to_agent` }, 400);
      }
    }
    
    const id = nanoid();
    const now = new Date();
    const priority = typeof body.priority === "number" ? body.priority : 100;
    const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
    
    await db.insert(policies).values({
      id,
      name: body.name.trim(),
      rules: JSON.stringify(body.rules),
      priority,
      enabled,
      createdAt: now,
    });
    
    return c.json({
      id,
      name: body.name.trim(),
      rules: body.rules,
      priority,
      enabled,
      createdAt: now.toISOString(),
    }, 201);
  });
  
  app.put("/api/policies/:id", async (c) => {
    const id = c.req.param("id");
    
    const existing = await db.select().from(policies).where(eq(policies.id, id)).limit(1);
    if (existing.length === 0) {
      return c.json({ error: "Policy not found" }, 404);
    }
    
    const body = await c.req.json();
    
    if (typeof body.name !== "string" || !body.name.trim()) {
      return c.json({ error: "name is required and must be a non-empty string" }, 400);
    }
    if (!Array.isArray(body.rules)) {
      return c.json({ error: "rules is required and must be an array" }, 400);
    }
    
    const priority = typeof body.priority === "number" ? body.priority : 100;
    const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
    
    await db.update(policies)
      .set({
        name: body.name.trim(),
        rules: JSON.stringify(body.rules),
        priority,
        enabled,
      })
      .where(eq(policies.id, id));
    
    return c.json({
      id,
      name: body.name.trim(),
      rules: body.rules,
      priority,
      enabled,
      createdAt: existing[0]!.createdAt,
    });
  });
  
  app.delete("/api/policies/:id", async (c) => {
    const id = c.req.param("id");
    
    const existing = await db.select().from(policies).where(eq(policies.id, id)).limit(1);
    if (existing.length === 0) {
      return c.json({ error: "Policy not found" }, 404);
    }
    
    await db.delete(policies).where(eq(policies.id, id));
    return c.json({ success: true, id });
  });
  
  // -------------- API Keys Routes (admin only) --------------
  
  app.use("/api/api-keys/*", requireScope("admin"));
  
  app.post("/api/api-keys", async (c) => {
    const body = await c.req.json();
    
    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return c.json({ error: "name is required" }, 400);
    }
    if (!Array.isArray(body.scopes) || body.scopes.length === 0) {
      return c.json({ error: "scopes is required and must be a non-empty array" }, 400);
    }
    
    const rateLimit = typeof body.rateLimit === "number" ? body.rateLimit : null;
    const { id, key } = await createApiKeyInDb(body.name.trim(), body.scopes, rateLimit);
    
    return c.json({
      id,
      key,
      name: body.name.trim(),
      scopes: body.scopes,
      rateLimit,
      message: "Save this key - it will not be shown again",
    }, 201);
  });
  
  app.get("/api/api-keys", async (c) => {
    const keys = await db.select({
      id: apiKeys.id,
      name: apiKeys.name,
      scopes: apiKeys.scopes,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      rateLimit: apiKeys.rateLimit,
    }).from(apiKeys);
    
    return c.json({
      keys: keys.map(k => ({
        ...k,
        scopes: JSON.parse(k.scopes),
        active: k.revokedAt === null,
      })),
    });
  });
  
  app.patch("/api/api-keys/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.scopes !== undefined) updateData.scopes = JSON.stringify(body.scopes);
    if (body.rateLimit !== undefined) updateData.rateLimit = body.rateLimit;
    
    if (Object.keys(updateData).length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }
    
    await db.update(apiKeys).set(updateData).where(eq(apiKeys.id, id));
    
    return c.json({ success: true });
  });
  
  app.delete("/api/api-keys/:id", async (c) => {
    const id = c.req.param("id");
    
    await db.update(apiKeys)
      .set({ revokedAt: Math.floor(Date.now() / 1000) })
      .where(eq(apiKeys.id, id));
    
    return c.json({ success: true, message: "API key revoked" });
  });
  
  // -------------- Webhooks Routes (admin only) --------------
  
  app.use("/api/webhooks/*", requireScope("admin"));
  
  app.post("/api/webhooks", async (c) => {
    const body = await c.req.json();
    
    if (!body.url || typeof body.url !== "string") {
      return c.json({ error: "url is required" }, 400);
    }
    if (!Array.isArray(body.events) || body.events.length === 0) {
      return c.json({ error: "events is required and must be a non-empty array" }, 400);
    }
    
    const id = nanoid();
    const secret = body.secret || randomBytes(32).toString("hex");
    
    await db.insert(webhooks).values({
      id,
      url: body.url,
      events: JSON.stringify(body.events),
      secret,
      createdAt: Date.now(),
      enabled: 1,
    });
    
    return c.json({
      id,
      url: body.url,
      events: body.events,
      secret,
      enabled: true,
      message: "Save this secret - it will not be shown again",
    }, 201);
  });
  
  app.get("/api/webhooks", async (c) => {
    const result = await db.select({
      id: webhooks.id,
      url: webhooks.url,
      events: webhooks.events,
      createdAt: webhooks.createdAt,
      enabled: webhooks.enabled,
    }).from(webhooks);
    
    return c.json({
      webhooks: result.map(w => ({
        ...w,
        events: JSON.parse(w.events),
        enabled: w.enabled === 1,
      })),
    });
  });
  
  app.get("/api/webhooks/:id", async (c) => {
    const id = c.req.param("id");
    
    const result = await db.select({
      id: webhooks.id,
      url: webhooks.url,
      events: webhooks.events,
      createdAt: webhooks.createdAt,
      enabled: webhooks.enabled,
    }).from(webhooks).where(eq(webhooks.id, id)).limit(1);
    
    if (result.length === 0) {
      return c.json({ error: "Webhook not found" }, 404);
    }
    
    const webhook = result[0]!;
    const deliveries = await db.select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, id))
      .orderBy(desc(webhookDeliveries.lastAttemptAt))
      .limit(20);
    
    return c.json({
      ...webhook,
      events: JSON.parse(webhook.events),
      enabled: webhook.enabled === 1,
      deliveries,
    });
  });
  
  app.patch("/api/webhooks/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    
    const updateData: Record<string, unknown> = {};
    if (body.url) updateData.url = body.url;
    if (body.events) updateData.events = JSON.stringify(body.events);
    if (body.enabled !== undefined) updateData.enabled = body.enabled ? 1 : 0;
    
    await db.update(webhooks).set(updateData).where(eq(webhooks.id, id));
    
    return c.json({ success: true });
  });
  
  app.delete("/api/webhooks/:id", async (c) => {
    const id = c.req.param("id");
    await db.delete(webhooks).where(eq(webhooks.id, id));
    return c.json({ success: true });
  });
  
  // -------------- Error Handlers --------------
  
  app.onError((err, c) => {
    console.error(`Error: ${err.message}`);
    return c.json({ error: "Internal Server Error", message: err.message }, 500);
  });
  
  app.notFound((c) => {
    return c.json({ error: "Not Found", message: `Route ${c.req.method} ${c.req.path} not found` }, 404);
  });
  
  return app;
}

// -------------- Test Variables --------------

let app: ReturnType<typeof createTestApp>;
let adminKey: string;
let readOnlyKey: string;

// -------------- Test Lifecycle --------------

beforeAll(async () => {
  app = createTestApp();
  
  // Create admin API key for tests
  const adminResult = await createApiKeyInDb("admin-test-key", ["admin"]);
  adminKey = adminResult.key;
  
  // Create read-only API key for scope tests
  const readOnlyResult = await createApiKeyInDb("read-only-test-key", ["request:read"]);
  readOnlyKey = readOnlyResult.key;
});

beforeEach(async () => {
  // Clear test data (but keep API keys)
  await db.delete(webhookDeliveries);
  await db.delete(webhooks);
  await db.delete(auditLogs);
  await db.delete(approvalRequests);
  await db.delete(policies);
  // Clear rate limit state
  clearTestRateLimits();
});

afterAll(() => {
  sqlite.close();
});

// -------------- Helper for requests --------------

function authHeader(key: string = adminKey) {
  return { Authorization: `Bearer ${key}` };
}

// -------------- Tests --------------

describe("Health Check", () => {
  it("should return 200 OK without auth", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.timestamp).toBeDefined();
  });
});

describe("Authentication", () => {
  it("should reject requests without Authorization header", async () => {
    const res = await app.request("/api/requests");
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Missing Authorization header");
  });
  
  it("should reject requests with invalid Authorization format", async () => {
    const res = await app.request("/api/requests", {
      headers: { Authorization: "Basic abc123" },
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Invalid Authorization format");
  });
  
  it("should reject requests with invalid API key", async () => {
    const res = await app.request("/api/requests", {
      headers: { Authorization: "Bearer invalid_key_12345" },
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Invalid API key");
  });
  
  it("should accept requests with valid API key", async () => {
    const res = await app.request("/api/requests", {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
  });
  
  it("should reject admin routes with non-admin scope", async () => {
    const res = await app.request("/api/api-keys", {
      headers: authHeader(readOnlyKey),
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Missing required scope");
  });
});

describe("Requests API", () => {
  it("should create a new approval request", async () => {
    const res = await app.request("/api/requests", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "file.delete",
        params: { path: "/important/file.txt" },
        context: { user: "test-user" },
        urgency: "high",
      }),
    });
    
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBeDefined();
    expect(json.action).toBe("file.delete");
    expect(json.params.path).toBe("/important/file.txt");
    expect(json.context.user).toBe("test-user");
    expect(json.urgency).toBe("high");
    expect(json.status).toBe("pending");
    expect(json.policyDecision).toBeDefined();
  });
  
  it("should reject request without action", async () => {
    const res = await app.request("/api/requests", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ params: {} }),
    });
    
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("action is required");
  });
  
  it("should get a request by ID", async () => {
    // Create a request first
    const createRes = await app.request("/api/requests", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "test.action" }),
    });
    const created = await createRes.json();
    
    // Fetch it
    const res = await app.request(`/api/requests/${created.id}`, {
      headers: authHeader(),
    });
    
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(created.id);
    expect(json.action).toBe("test.action");
  });
  
  it("should return 404 for non-existent request", async () => {
    const res = await app.request("/api/requests/nonexistent123", {
      headers: authHeader(),
    });
    
    expect(res.status).toBe(404);
  });
  
  it("should list requests with pagination", async () => {
    // Create multiple requests
    for (let i = 0; i < 5; i++) {
      await app.request("/api/requests", {
        method: "POST",
        headers: {
          ...authHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: `test.action.${i}` }),
      });
    }
    
    // List with limit
    const res = await app.request("/api/requests?limit=3", {
      headers: authHeader(),
    });
    
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.requests).toHaveLength(3);
    expect(json.pagination.total).toBe(5);
    expect(json.pagination.hasMore).toBe(true);
  });
  
  it("should filter requests by status", async () => {
    // Create a request
    const createRes = await app.request("/api/requests", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "test.filter" }),
    });
    const created = await createRes.json();
    
    // Approve it
    await app.request(`/api/requests/${created.id}/decide`, {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        decision: "approved",
        decidedBy: "admin",
        reason: "Test approval",
      }),
    });
    
    // Filter by approved status
    const res = await app.request("/api/requests?status=approved", {
      headers: authHeader(),
    });
    
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.requests.length).toBeGreaterThan(0);
    expect(json.requests.every((r: any) => r.status === "approved")).toBe(true);
  });
  
  it("should approve a pending request", async () => {
    // Create a request
    const createRes = await app.request("/api/requests", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "test.approve" }),
    });
    const created = await createRes.json();
    
    // Approve it
    const res = await app.request(`/api/requests/${created.id}/decide`, {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        decision: "approved",
        decidedBy: "admin",
        reason: "Looks good",
      }),
    });
    
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("approved");
    expect(json.decidedBy).toBe("admin");
    expect(json.decisionReason).toBe("Looks good");
  });
  
  it("should deny a pending request", async () => {
    // Create a request
    const createRes = await app.request("/api/requests", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "test.deny" }),
    });
    const created = await createRes.json();
    
    // Deny it
    const res = await app.request(`/api/requests/${created.id}/decide`, {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        decision: "denied",
        decidedBy: "admin",
        reason: "Not allowed",
      }),
    });
    
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("denied");
    expect(json.decidedBy).toBe("admin");
  });
  
  it("should reject decision on already decided request", async () => {
    // Create and approve a request
    const createRes = await app.request("/api/requests", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "test.double" }),
    });
    const created = await createRes.json();
    
    await app.request(`/api/requests/${created.id}/decide`, {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ decision: "approved", decidedBy: "admin" }),
    });
    
    // Try to decide again
    const res = await app.request(`/api/requests/${created.id}/decide`, {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ decision: "denied", decidedBy: "admin" }),
    });
    
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("not pending");
  });
  
  it("should get audit trail for request", async () => {
    // Create a request
    const createRes = await app.request("/api/requests", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "test.audit" }),
    });
    const created = await createRes.json();
    
    // Approve it
    await app.request(`/api/requests/${created.id}/decide`, {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ decision: "approved", decidedBy: "admin" }),
    });
    
    // Get audit trail
    const res = await app.request(`/api/requests/${created.id}/audit`, {
      headers: authHeader(),
    });
    
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.length).toBeGreaterThanOrEqual(2); // created + approved
    expect(json.some((e: any) => e.eventType === "created")).toBe(true);
    expect(json.some((e: any) => e.eventType === "approved")).toBe(true);
  });
});

describe("Policies API", () => {
  it("should create a new policy", async () => {
    const res = await app.request("/api/policies", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Auto-approve reads",
        rules: [
          {
            match: { action: "file.read" },
            decision: "auto_approve",
          },
        ],
        priority: 10,
        enabled: true,
      }),
    });
    
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBeDefined();
    expect(json.name).toBe("Auto-approve reads");
    expect(json.rules).toHaveLength(1);
    expect(json.priority).toBe(10);
    expect(json.enabled).toBe(true);
  });
  
  it("should list policies", async () => {
    // Create a policy
    await app.request("/api/policies", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Test Policy",
        rules: [{ match: { action: "test" }, decision: "auto_approve" }],
      }),
    });
    
    // List
    const res = await app.request("/api/policies", {
      headers: authHeader(),
    });
    
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.length).toBeGreaterThan(0);
    expect(json[0].name).toBe("Test Policy");
  });
  
  it("should update a policy", async () => {
    // Create a policy
    const createRes = await app.request("/api/policies", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Original Name",
        rules: [{ match: { action: "test" }, decision: "auto_approve" }],
      }),
    });
    const created = await createRes.json();
    
    // Update it
    const res = await app.request(`/api/policies/${created.id}`, {
      method: "PUT",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated Name",
        rules: [{ match: { action: "updated" }, decision: "auto_deny" }],
        priority: 5,
        enabled: false,
      }),
    });
    
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("Updated Name");
    expect(json.rules[0].match.action).toBe("updated");
    expect(json.priority).toBe(5);
    expect(json.enabled).toBe(false);
  });
  
  it("should delete a policy", async () => {
    // Create a policy
    const createRes = await app.request("/api/policies", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "To Delete",
        rules: [{ match: { action: "test" }, decision: "auto_approve" }],
      }),
    });
    const created = await createRes.json();
    
    // Delete it
    const res = await app.request(`/api/policies/${created.id}`, {
      method: "DELETE",
      headers: authHeader(),
    });
    
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
  
  it("should auto-approve based on policy", async () => {
    // Create auto-approve policy
    await app.request("/api/policies", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Auto-approve file.read",
        rules: [{ match: { action: "file.read" }, decision: "auto_approve" }],
        priority: 1,
        enabled: true,
      }),
    });
    
    // Create request matching the policy
    const res = await app.request("/api/requests", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "file.read" }),
    });
    
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.status).toBe("approved");
    expect(json.decidedBy).toBe("policy");
    expect(json.policyDecision.decision).toBe("auto_approve");
  });
  
  it("should auto-deny based on policy", async () => {
    // Create auto-deny policy
    await app.request("/api/policies", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Auto-deny dangerous",
        rules: [{ match: { action: "system.shutdown" }, decision: "auto_deny" }],
        priority: 1,
        enabled: true,
      }),
    });
    
    // Create request matching the policy
    const res = await app.request("/api/requests", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "system.shutdown" }),
    });
    
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.status).toBe("denied");
    expect(json.decidedBy).toBe("policy");
    expect(json.policyDecision.decision).toBe("auto_deny");
  });
});

describe("API Keys API", () => {
  it("should create a new API key", async () => {
    const res = await app.request("/api/api-keys", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "New Test Key",
        scopes: ["request:read", "request:create"],
      }),
    });
    
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBeDefined();
    expect(json.key).toMatch(/^agk_/);
    expect(json.name).toBe("New Test Key");
    expect(json.scopes).toEqual(["request:read", "request:create"]);
    expect(json.message).toContain("Save this key");
  });
  
  it("should list API keys without exposing keys", async () => {
    const res = await app.request("/api/api-keys", {
      headers: authHeader(),
    });
    
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.keys).toBeDefined();
    expect(json.keys.length).toBeGreaterThan(0);
    // Should not expose the actual key
    expect(json.keys[0].key).toBeUndefined();
    expect(json.keys[0].keyHash).toBeUndefined();
  });
  
  it("should revoke an API key", async () => {
    // Create a key
    const createRes = await app.request("/api/api-keys", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "To Revoke", scopes: ["admin"] }),
    });
    const created = await createRes.json();
    
    // Revoke it
    const res = await app.request(`/api/api-keys/${created.id}`, {
      method: "DELETE",
      headers: authHeader(),
    });
    
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    
    // Verify the key no longer works
    const verifyRes = await app.request("/api/requests", {
      headers: { Authorization: `Bearer ${created.key}` },
    });
    expect(verifyRes.status).toBe(401);
  });
});

describe("Webhooks API", () => {
  it("should create a webhook", async () => {
    const res = await app.request("/api/webhooks", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: "https://example.com/webhook",
        events: ["request.approved", "request.denied"],
      }),
    });
    
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBeDefined();
    expect(json.url).toBe("https://example.com/webhook");
    expect(json.events).toEqual(["request.approved", "request.denied"]);
    expect(json.secret).toBeDefined();
    expect(json.enabled).toBe(true);
  });
  
  it("should list webhooks without exposing secrets", async () => {
    // Create a webhook
    await app.request("/api/webhooks", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: "https://example.com/hook",
        events: ["request.approved"],
      }),
    });
    
    // List
    const res = await app.request("/api/webhooks", {
      headers: authHeader(),
    });
    
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.webhooks).toBeDefined();
    expect(json.webhooks.length).toBeGreaterThan(0);
    expect(json.webhooks[0].secret).toBeUndefined();
  });
  
  it("should get webhook details with deliveries", async () => {
    // Create a webhook
    const createRes = await app.request("/api/webhooks", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: "https://example.com/details",
        events: ["request.approved"],
      }),
    });
    const created = await createRes.json();
    
    // Get details
    const res = await app.request(`/api/webhooks/${created.id}`, {
      headers: authHeader(),
    });
    
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(created.id);
    expect(json.url).toBe("https://example.com/details");
    expect(json.deliveries).toBeDefined();
  });
  
  it("should update a webhook", async () => {
    // Create a webhook
    const createRes = await app.request("/api/webhooks", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: "https://example.com/original",
        events: ["request.approved"],
      }),
    });
    const created = await createRes.json();
    
    // Update it
    const res = await app.request(`/api/webhooks/${created.id}`, {
      method: "PATCH",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: "https://example.com/updated",
        events: ["request.denied"],
        enabled: false,
      }),
    });
    
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
  
  it("should delete a webhook", async () => {
    // Create a webhook
    const createRes = await app.request("/api/webhooks", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: "https://example.com/delete",
        events: ["request.approved"],
      }),
    });
    const created = await createRes.json();
    
    // Delete it
    const res = await app.request(`/api/webhooks/${created.id}`, {
      method: "DELETE",
      headers: authHeader(),
    });
    
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});

describe("404 Handler", () => {
  it("should return 404 for unknown routes", async () => {
    const res = await app.request("/api/unknown", {
      headers: authHeader(),
    });
    
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Not Found");
    expect(json.message).toContain("/api/unknown");
  });
});

describe("Rate Limiting", () => {
  it("should allow requests when no rate limit is set", async () => {
    // Admin key has no rate limit set
    for (let i = 0; i < 10; i++) {
      const res = await app.request("/api/requests", {
        headers: authHeader(),
      });
      expect(res.status).toBe(200);
    }
  });
  
  it("should return 429 when rate limit is exceeded", async () => {
    // Create a key with rate limit of 3 requests per minute
    const { key: limitedKey } = await createApiKeyInDb("rate-limited-key", ["admin"], 3);
    
    // First 3 requests should succeed
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/api/requests", {
        headers: { Authorization: `Bearer ${limitedKey}` },
      });
      expect(res.status).toBe(200);
    }
    
    // 4th request should be rate limited
    const res = await app.request("/api/requests", {
      headers: { Authorization: `Bearer ${limitedKey}` },
    });
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toBe("Rate limit exceeded");
  });
  
  it("should include X-RateLimit-* headers on successful responses", async () => {
    const { key: limitedKey } = await createApiKeyInDb("headers-test-key", ["admin"], 10);
    
    const res = await app.request("/api/requests", {
      headers: { Authorization: `Bearer ${limitedKey}` },
    });
    
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("9");
    expect(res.headers.get("X-RateLimit-Reset")).toBeDefined();
  });
  
  it("should include Retry-After header on 429 response", async () => {
    const { key: limitedKey } = await createApiKeyInDb("retry-after-key", ["admin"], 1);
    
    // Use up the limit
    await app.request("/api/requests", {
      headers: { Authorization: `Bearer ${limitedKey}` },
    });
    
    // This should be rate limited
    const res = await app.request("/api/requests", {
      headers: { Authorization: `Bearer ${limitedKey}` },
    });
    
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeDefined();
    const retryAfter = parseInt(res.headers.get("Retry-After")!, 10);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });
  
  it("should decrement remaining count with each request", async () => {
    const { key: limitedKey } = await createApiKeyInDb("decrement-key", ["admin"], 5);
    
    for (let i = 4; i >= 0; i--) {
      const res = await app.request("/api/requests", {
        headers: { Authorization: `Bearer ${limitedKey}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("X-RateLimit-Remaining")).toBe(i.toString());
    }
  });
  
  it("should not include rate limit headers when no limit is set", async () => {
    // Admin key has no rate limit
    const res = await app.request("/api/requests", {
      headers: authHeader(),
    });
    
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBeNull();
    expect(res.headers.get("X-RateLimit-Remaining")).toBeNull();
  });
  
  it("should allow creating API key with rate limit", async () => {
    const res = await app.request("/api/api-keys", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Rate Limited Key",
        scopes: ["request:read"],
        rateLimit: 100,
      }),
    });
    
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.rateLimit).toBe(100);
  });
  
  it("should list API keys with rate limit info", async () => {
    await createApiKeyInDb("list-rate-limit-key", ["admin"], 50);
    
    const res = await app.request("/api/api-keys", {
      headers: authHeader(),
    });
    
    expect(res.status).toBe(200);
    const json = await res.json();
    const key = json.keys.find((k: any) => k.name === "list-rate-limit-key");
    expect(key).toBeDefined();
    expect(key.rateLimit).toBe(50);
  });
  
  it("should update API key rate limit", async () => {
    const { id } = await createApiKeyInDb("update-rate-limit-key", ["admin"], 10);
    
    const res = await app.request(`/api/api-keys/${id}`, {
      method: "PATCH",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rateLimit: 200,
      }),
    });
    
    expect(res.status).toBe(200);
    
    // Verify the update
    const listRes = await app.request("/api/api-keys", {
      headers: authHeader(),
    });
    const listJson = await listRes.json();
    const updated = listJson.keys.find((k: any) => k.id === id);
    expect(updated.rateLimit).toBe(200);
  });
  
  it("should allow removing rate limit by setting to null", async () => {
    const { id } = await createApiKeyInDb("remove-rate-limit-key", ["admin"], 10);
    
    const res = await app.request(`/api/api-keys/${id}`, {
      method: "PATCH",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rateLimit: null,
      }),
    });
    
    expect(res.status).toBe(200);
    
    // Verify the update
    const listRes = await app.request("/api/api-keys", {
      headers: authHeader(),
    });
    const listJson = await listRes.json();
    const updated = listJson.keys.find((k: any) => k.id === id);
    expect(updated.rateLimit).toBeNull();
  });
});
