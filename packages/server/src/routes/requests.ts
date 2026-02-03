// @agentgate/server - Approval request routes

import { Hono } from "hono";
import { nanoid } from "nanoid";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, approvalRequests, auditLogs, policies } from "../db/index.js";
import {
  evaluatePolicy,
  EventNames,
  createBaseEvent,
  getGlobalEmitter,
  type ApprovalRequest,
  type Policy as CorePolicy,
  type PolicyRule,
  type RequestCreatedEvent,
  type RequestDecidedEvent,
} from "@agentgate/core";
import { logAuditEvent } from "../lib/audit.js";
import { deliverWebhook } from "../lib/webhook.js";
import { getGlobalDispatcher } from "../lib/notification/index.js";

const requestsRouter = new Hono();

// Validation helper for creating requests
function validateCreateRequestBody(body: unknown): {
  valid: boolean;
  error?: string;
  data?: {
    action: string;
    params: Record<string, unknown>;
    context: Record<string, unknown>;
    urgency: "low" | "normal" | "high" | "critical";
    expiresAt?: Date;
  };
} {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body required" };
  }

  const b = body as Record<string, unknown>;

  if (typeof b.action !== "string" || !b.action.trim()) {
    return { valid: false, error: "action is required and must be a non-empty string" };
  }

  const params = b.params && typeof b.params === "object" ? (b.params as Record<string, unknown>) : {};
  const context = b.context && typeof b.context === "object" ? (b.context as Record<string, unknown>) : {};

  // Validate urgency
  const validUrgencies = ["low", "normal", "high", "critical"];
  const urgency = typeof b.urgency === "string" && validUrgencies.includes(b.urgency) 
    ? (b.urgency as "low" | "normal" | "high" | "critical")
    : "normal";

  // Parse expiresAt if provided
  let expiresAt: Date | undefined;
  if (b.expiresAt) {
    const parsed = new Date(b.expiresAt as string);
    if (!isNaN(parsed.getTime())) {
      expiresAt = parsed;
    }
  }

  return {
    valid: true,
    data: {
      action: b.action.trim(),
      params,
      context,
      urgency,
      expiresAt,
    },
  };
}

// Validation helper for decision
function validateDecisionBody(body: unknown): {
  valid: boolean;
  error?: string;
  data?: {
    decision: "approved" | "denied";
    reason?: string;
    decidedBy: string;
  };
} {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body required" };
  }

  const b = body as Record<string, unknown>;

  if (!["approved", "denied"].includes(b.decision as string)) {
    return { valid: false, error: "decision must be 'approved' or 'denied'" };
  }

  if (typeof b.decidedBy !== "string" || !b.decidedBy.trim()) {
    return { valid: false, error: "decidedBy is required and must be a non-empty string" };
  }

  return {
    valid: true,
    data: {
      decision: b.decision as "approved" | "denied",
      reason: typeof b.reason === "string" ? b.reason : undefined,
      decidedBy: b.decidedBy.trim(),
    },
  };
}

// Helper to convert DB row to response format
function formatRequest(row: typeof approvalRequests.$inferSelect) {
  return {
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
  };
}

// POST /api/requests - Create new approval request
requestsRouter.post("/", async (c) => {
  const body = await c.req.json();
  const validation = validateCreateRequestBody(body);

  if (!validation.valid) {
    return c.json({ error: validation.error }, 400);
  }

  const { action, params, context, urgency, expiresAt } = validation.data!;
  const id = nanoid();
  const now = new Date();

  // Load policies from database
  const allPolicies = await db.select().from(policies).orderBy(policies.priority);
  
  // Convert DB policies to core Policy type
  const corePolicies: CorePolicy[] = allPolicies.map((p) => ({
    id: p.id,
    name: p.name,
    rules: JSON.parse(p.rules) as PolicyRule[],
    priority: p.priority,
    enabled: p.enabled,
  }));

  // Build ApprovalRequest object for policy evaluation
  const requestForEval: ApprovalRequest = {
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

  // Determine initial status based on policy decision
  let status: "pending" | "approved" | "denied" = "pending";
  let decidedBy: string | null = null;
  let decidedAt: Date | null = null;
  let decisionReason: string | null = null;

  if (policyDecision.decision === "auto_approve") {
    status = "approved";
    decidedBy = "policy";
    decidedAt = now;
    decisionReason = policyDecision.matchedRule 
      ? `Auto-approved by policy rule matching: ${JSON.stringify(policyDecision.matchedRule.match)}`
      : "Auto-approved by policy";
  } else if (policyDecision.decision === "auto_deny") {
    status = "denied";
    decidedBy = "policy";
    decidedAt = now;
    decisionReason = policyDecision.matchedRule
      ? `Auto-denied by policy rule matching: ${JSON.stringify(policyDecision.matchedRule.match)}`
      : "Auto-denied by policy";
  }
  // route_to_human and route_to_agent stay pending

  // Insert into database
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

  // Log audit event
  await logAuditEvent(id, "created", "system", {
    action,
    params,
    context,
    urgency,
    policyDecision: policyDecision.decision,
    matchedRule: policyDecision.matchedRule,
  });

  // Emit request.created event
  const createdEvent: RequestCreatedEvent = {
    ...createBaseEvent(EventNames.REQUEST_CREATED, "server"),
    payload: {
      requestId: id,
      action,
      params,
      context,
      urgency,
      expiresAt: expiresAt?.toISOString(),
      policyDecision: policyDecision.decision !== "route_to_human" && policyDecision.decision !== "route_to_agent"
        ? { decision: policyDecision.decision }
        : undefined,
    },
  };

  // Emit to global emitter (for internal listeners)
  getGlobalEmitter().emitSync(createdEvent);

  // Dispatch to notification channels (async, fire-and-forget)
  // Only dispatch for pending requests (auto-approved/denied will get decided event instead)
  if (status === "pending") {
    getGlobalDispatcher().dispatchSync(createdEvent, policyDecision.channels);
  }

  // If auto-approved or auto-denied, log that event too and emit decided event
  if (status === "approved") {
    await logAuditEvent(id, "approved", "policy", {
      reason: decisionReason,
      automatic: true,
    });
    // Deliver webhook for auto-approval
    await deliverWebhook("request.approved", {
      request: {
        id,
        action,
        params,
        context,
        status,
        urgency,
        createdAt: now.toISOString(),
        decidedAt: decidedAt?.toISOString() || null,
        decidedBy,
        decisionReason,
      },
    });

    // Emit decided event for auto-approval
    const decidedEvent: RequestDecidedEvent = {
      ...createBaseEvent(EventNames.REQUEST_DECIDED, "server"),
      payload: {
        requestId: id,
        action,
        status: "approved",
        decidedBy: "policy",
        decidedByType: "policy",
        reason: decisionReason || undefined,
        decisionTimeMs: 0, // Instant decision
      },
    };
    getGlobalEmitter().emitSync(decidedEvent);
    getGlobalDispatcher().dispatchSync(decidedEvent, policyDecision.channels);
  } else if (status === "denied") {
    await logAuditEvent(id, "denied", "policy", {
      reason: decisionReason,
      automatic: true,
    });
    // Deliver webhook for auto-denial
    await deliverWebhook("request.denied", {
      request: {
        id,
        action,
        params,
        context,
        status,
        urgency,
        createdAt: now.toISOString(),
        decidedAt: decidedAt?.toISOString() || null,
        decidedBy,
        decisionReason,
      },
    });

    // Emit decided event for auto-denial
    const decidedEvent: RequestDecidedEvent = {
      ...createBaseEvent(EventNames.REQUEST_DECIDED, "server"),
      payload: {
        requestId: id,
        action,
        status: "denied",
        decidedBy: "policy",
        decidedByType: "policy",
        reason: decisionReason || undefined,
        decisionTimeMs: 0, // Instant decision
      },
    };
    getGlobalEmitter().emitSync(decidedEvent);
    getGlobalDispatcher().dispatchSync(decidedEvent, policyDecision.channels);
  }

  const response = {
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
  };

  return c.json(response, 201);
});

// GET /api/requests/:id - Get request by ID
requestsRouter.get("/:id", async (c) => {
  const { id } = c.req.param();

  const result = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, id))
    .limit(1);

  if (result.length === 0) {
    return c.json({ error: "Request not found" }, 404);
  }

  return c.json(formatRequest(result[0]!));
});

// GET /api/requests - List requests with filters
requestsRouter.get("/", async (c) => {
  const status = c.req.query("status");
  const action = c.req.query("action");
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  // Build conditions
  const conditions = [];
  if (status && ["pending", "approved", "denied", "expired"].includes(status)) {
    conditions.push(eq(approvalRequests.status, status as "pending" | "approved" | "denied" | "expired"));
  }
  if (action) {
    conditions.push(eq(approvalRequests.action, action));
  }

  // Build query
  let query = db.select().from(approvalRequests);
  
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  const results = await query
    .orderBy(desc(approvalRequests.createdAt))
    .limit(limit)
    .offset(offset);

  // Get total count for pagination
  let countQuery = db.select({ count: sql<number>`count(*)` }).from(approvalRequests);
  if (conditions.length > 0) {
    countQuery = countQuery.where(and(...conditions)) as typeof countQuery;
  }
  const countResult = await countQuery;
  const total = countResult[0]?.count || 0;

  return c.json({
    requests: results.map(formatRequest),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + results.length < total,
    },
  });
});

// POST /api/requests/:id/decide - Submit decision
requestsRouter.post("/:id/decide", async (c) => {
  const { id } = c.req.param();

  // Check if request exists and is pending
  const existing = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, id))
    .limit(1);

  if (existing.length === 0) {
    return c.json({ error: "Request not found" }, 404);
  }

  const existingRequest = existing[0]!;
  if (existingRequest.status !== "pending") {
    return c.json(
      { error: `Request is not pending (current status: ${existingRequest.status})` },
      400
    );
  }

  const body = await c.req.json();
  const validation = validateDecisionBody(body);

  if (!validation.valid) {
    return c.json({ error: validation.error }, 400);
  }

  const { decision, reason, decidedBy } = validation.data!;
  const now = new Date();

  // Update the request
  await db
    .update(approvalRequests)
    .set({
      status: decision,
      decidedAt: now,
      decidedBy,
      decisionReason: reason || null,
      updatedAt: now,
    })
    .where(eq(approvalRequests.id, id));

  // Log audit event
  await logAuditEvent(
    id,
    decision === "approved" ? "approved" : "denied",
    decidedBy,
    { reason, automatic: false }
  );

  // Fetch updated record
  const updated = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, id))
    .limit(1);

  const updatedRequest = formatRequest(updated[0]!);

  // Deliver webhook for manual decision
  await deliverWebhook(`request.${decision}`, { request: updatedRequest });

  // Emit decided event
  const decisionTimeMs = now.getTime() - existingRequest.createdAt.getTime();
  const decidedEvent: RequestDecidedEvent = {
    ...createBaseEvent(EventNames.REQUEST_DECIDED, "server"),
    payload: {
      requestId: id,
      action: existingRequest.action,
      status: decision,
      decidedBy,
      decidedByType: "human",
      reason,
      decisionTimeMs,
    },
  };

  getGlobalEmitter().emitSync(decidedEvent);
  getGlobalDispatcher().dispatchSync(decidedEvent);

  return c.json(updatedRequest);
});

// GET /api/requests/:id/audit - Get audit trail
requestsRouter.get("/:id/audit", async (c) => {
  const { id } = c.req.param();

  // Check if request exists
  const existing = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, id))
    .limit(1);

  if (existing.length === 0) {
    return c.json({ error: "Request not found" }, 404);
  }

  // Fetch audit logs
  const logs = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.requestId, id))
    .orderBy(auditLogs.createdAt);

  const formatted = logs.map((log) => ({
    id: log.id,
    requestId: log.requestId,
    eventType: log.eventType,
    actor: log.actor,
    details: log.details ? JSON.parse(log.details) : null,
    createdAt: log.createdAt.toISOString(),
  }));

  return c.json(formatted);
});

export default requestsRouter;
