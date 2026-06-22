// @agentgate/server - Approval request routes

import { Hono } from "hono";
import { nanoid } from "nanoid";
import { eq, desc, asc, and, sql } from "drizzle-orm";
import { getDb, approvalRequests, auditLogs } from "../db/index.js";
import {
  evaluatePolicy,
  EventNames,
  createBaseEvent,
  getGlobalEmitter,
  type ApprovalRequest,
  type Policy as CorePolicy,
  type RequestCreatedEvent,
  type RequestDecidedEvent,
} from "@agentgate/core";
import { logAuditEvent } from "../lib/audit.js";
import { owaspRiskForPolicyDecision } from "../lib/owasp.js";
import { resolveVerifiedAgentId, resolveEffectiveAgentId } from "../lib/agent-tokens.js";
import { getConfig } from "../config.js";
import type { ApiKey } from "../db/schema.js";
import { deliverWebhook } from "../lib/webhook.js";
import { getGlobalDispatcher } from "../lib/notification/index.js";
import { getCachedPolicies } from "../lib/policy-cache.js";
import { checkOverrides } from "./overrides.js";

// Variables: the auth middleware sets the validated apiKey row on api-key auth.
const requestsRouter = new Hono<{ Variables: { apiKey?: ApiKey } }>();

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

/**
 * Handles the 4-step auto-decision pipeline for policy-driven approve/deny.
 *
 * Steps:
 *   1. **Audit log** – records the decision in the audit trail
 *   2. **Webhook** – delivers `request.approved` or `request.denied` webhook
 *   3. **Event emit** – emits a `RequestDecidedEvent` on the global emitter
 *   4. **Dispatch** – fans the decided event out to notification channels
 *
 * @param opts.requestId   - Unique request identifier
 * @param opts.action      - The action string from the original request
 * @param opts.status      - The decision outcome (`"approved"` | `"denied"`)
 * @param opts.decidedBy   - Actor that made the decision (e.g. `"policy"`)
 * @param opts.decisionReason - Human-readable reason for the decision
 * @param opts.requestSnapshot - Serialisable request object for the webhook payload
 * @param opts.channels    - Optional notification channels from the policy decision
 */
async function handleAutoDecision(opts: {
  requestId: string;
  action: string;
  status: "approved" | "denied";
  decidedBy: string;
  decidedByType: "policy" | "human" | "agent";
  decisionReason: string | null;
  requestSnapshot: Record<string, unknown>;
  channels?: string[];
}): Promise<void> {
  const { requestId, action, status, decidedBy, decidedByType, decisionReason, requestSnapshot, channels } = opts;

  // Step 1: Audit log
  await logAuditEvent(requestId, status, decidedBy, {
    reason: decisionReason,
    automatic: true,
  });

  // Step 2: Webhook
  await deliverWebhook(`request.${status}`, { request: requestSnapshot });

  // Step 3: Event emit
  const decidedEvent: RequestDecidedEvent = {
    ...createBaseEvent(EventNames.REQUEST_DECIDED, "server"),
    payload: {
      requestId,
      action,
      status,
      decidedBy,
      decidedByType,
      reason: decisionReason || undefined,
      decisionTimeMs: 0,
    },
  };
  getGlobalEmitter().emitSync(decidedEvent);

  // Step 4: Dispatch to notification channels
  getGlobalDispatcher().dispatchSync(decidedEvent, channels);
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
    slaRemainingMs: row.expiresAt ? row.expiresAt.getTime() - Date.now() : null,
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

  // Load policies from cache (parsed & priority-sorted)
  const corePolicies: CorePolicy[] = await getCachedPolicies();

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

  // Agent-identity spine: resolve the VERIFIED agent id — distinct from the
  // caller-claimed context.agentId, which is unauthenticated. Prefers a
  // short-lived agent Bearer token (X-Agent-Token from POST /api/agents/token)
  // over the legacy X-Agent-Id / X-Agent-Secret headers. Null when neither is
  // presented or verification fails. Resolved BEFORE overrides/policies so both
  // can scope on the verified identity (issue #13).
  const verifiedAgentId = await resolveVerifiedAgentId(
    {
      agentToken: c.req.header("x-agent-token"),
      agentId: c.req.header("x-agent-id"),
      agentSecret: c.req.header("x-agent-secret"),
    },
    getConfig().authMode,
  );

  // Virtual key (issue #13): a key bound to an agent IS that agent's credential,
  // so the binding is authoritative and promotes to the verified id. A request
  // that separately verifies as a DIFFERENT agent is a conflict, and a binding
  // to a now-revoked agent is rejected — agent revocation does not cascade to
  // keys, so the bound agent's liveness is re-checked here at use time.
  const boundAgentId = c.get("apiKey")?.agentId ?? null;
  const resolved = await resolveEffectiveAgentId(boundAgentId, verifiedAgentId);
  if ("reject" in resolved) {
    return c.json(
      {
        error:
          resolved.reject === "conflict"
            ? "API key is bound to a different agent than the request claims"
            : "API key is bound to a revoked or unknown agent",
      },
      403,
    );
  }
  const effectiveAgentId = resolved.agentId;

  // Check overrides BEFORE static policies, keyed on the VERIFIED agent id.
  let overrideMatch: Awaited<ReturnType<typeof checkOverrides>> = null;
  if (effectiveAgentId) {
    overrideMatch = await checkOverrides(effectiveAgentId, action);
  }

  // Run policy engine, scoped to the verified agent + the requested tool/action.
  const policyDecision = evaluatePolicy(requestForEval, corePolicies, {
    agentId: effectiveAgentId,
    tool: action,
  });

  // Determine initial status based on override or policy decision
  let status: "pending" | "approved" | "denied" = "pending";
  let decidedBy: string | null = null;
  let decidedAt: Date | null = null;
  let decisionReason: string | null = null;

  if (overrideMatch) {
    // Override forces require_approval → stays pending (route to human)
    status = "pending";
    decisionReason = `Override active: ${overrideMatch.reason || "dynamic override"}`;
  } else if (policyDecision.decision === "auto_approve") {
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
  await getDb().insert(approvalRequests).values({
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
    verifiedAgentId: effectiveAgentId,
  });

  // Log audit event
  await logAuditEvent(id, "created", "system", {
    action,
    params,
    context,
    urgency,
    policyDecision: policyDecision.decision,
    matchedRule: policyDecision.matchedRule,
    // Compliance evidence: tag the decision with the OWASP LLM risk it
    // mitigates (gating/escalating a tool action = LLM06 Excessive Agency).
    owaspRisk: owaspRiskForPolicyDecision(policyDecision.decision),
    // Who actually made the request, cryptographically verified (vs the
    // unverified context.agentId claim).
    verifiedAgentId: effectiveAgentId,
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

  // If auto-approved or auto-denied, run the 4-step auto-decision pipeline
  if (status === "approved" || status === "denied") {
    await handleAutoDecision({
      requestId: id,
      action,
      status,
      decidedBy: "policy",
      decidedByType: "policy",
      decisionReason,
      requestSnapshot: {
        id, action, params, context, status, urgency,
        createdAt: now.toISOString(),
        decidedAt: decidedAt?.toISOString() || null,
        decidedBy, decisionReason,
      },
      channels: policyDecision.channels,
    });
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

// GET /api/requests/queue-stats - Get pending queue statistics
requestsRouter.get("/queue-stats", async (c) => {
  const pendingCondition = eq(approvalRequests.status, "pending");

  // Get all pending requests for stats computation
  const pendingRows = await getDb()
    .select({
      urgency: approvalRequests.urgency,
      createdAt: approvalRequests.createdAt,
    })
    .from(approvalRequests)
    .where(pendingCondition);

  const byUrgency = { critical: 0, high: 0, normal: 0, low: 0 };
  let oldestCreatedAt: Date | null = null;

  for (const row of pendingRows) {
    const u = row.urgency as keyof typeof byUrgency;
    if (u in byUrgency) byUrgency[u]++;
    if (!oldestCreatedAt || row.createdAt < oldestCreatedAt) {
      oldestCreatedAt = row.createdAt;
    }
  }

  return c.json({
    total_pending: pendingRows.length,
    by_urgency: byUrgency,
    oldest_pending_age_ms: oldestCreatedAt ? Date.now() - oldestCreatedAt.getTime() : null,
  });
});

// GET /api/requests/:id - Get request by ID
requestsRouter.get("/:id", async (c) => {
  const { id } = c.req.param();

  const result = await getDb()
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
  const sort = c.req.query("sort");
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

  // Determine sort order
  const urgencyOrder = sql`CASE ${approvalRequests.urgency} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`;
  let orderClause;
  if (sort === "urgency") {
    orderClause = asc(urgencyOrder);
  } else if (sort === "created_at") {
    orderClause = asc(approvalRequests.createdAt);
  } else if (sort === "sla_remaining") {
    // Sort by expiresAt ascending; NULLs last
    orderClause = sql`CASE WHEN ${approvalRequests.expiresAt} IS NULL THEN 1 ELSE 0 END, ${approvalRequests.expiresAt} ASC`;
  } else {
    orderClause = desc(approvalRequests.createdAt);
  }

  // Build query
  let query = getDb().select().from(approvalRequests);

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  const results = await query
    .orderBy(orderClause)
    .limit(limit)
    .offset(offset);

  // Get total count for pagination
  let countQuery = getDb().select({ count: sql<number>`count(*)` }).from(approvalRequests);
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

  const body = await c.req.json();
  const validation = validateDecisionBody(body);

  if (!validation.valid) {
    return c.json({ error: validation.error }, 400);
  }

  const { decision, reason, decidedBy } = validation.data!;
  const now = new Date();

  // Atomic conditional update: only update if status is still 'pending'
  const result = await getDb()
    .update(approvalRequests)
    .set({
      status: decision,
      decidedAt: now,
      decidedBy,
      decisionReason: reason || null,
      updatedAt: now,
    })
    .where(and(
      eq(approvalRequests.id, id),
      eq(approvalRequests.status, 'pending')
    ))
    .returning();

  if (result.length === 0) {
    // Re-read to determine error type: not found vs already decided
    const current = await getDb()
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, id))
      .limit(1);

    if (current.length === 0) {
      return c.json({ error: "Request not found" }, 404);
    }
    return c.json(
      { error: `Request already ${current[0]!.status}` },
      409
    );
  }

  const updatedRow = result[0]!;

  // Log audit event
  await logAuditEvent(
    id,
    decision === "approved" ? "approved" : "denied",
    decidedBy,
    { reason, automatic: false }
  );

  const updatedRequest = formatRequest(updatedRow);

  // Deliver webhook for manual decision
  await deliverWebhook(`request.${decision}`, { request: updatedRequest });

  // Emit decided event
  const decisionTimeMs = now.getTime() - updatedRow.createdAt.getTime();
  const decidedEvent: RequestDecidedEvent = {
    ...createBaseEvent(EventNames.REQUEST_DECIDED, "server"),
    payload: {
      requestId: id,
      action: updatedRow.action,
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
  const existing = await getDb()
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, id))
    .limit(1);

  if (existing.length === 0) {
    return c.json({ error: "Request not found" }, 404);
  }

  // Fetch audit logs
  const logs = await getDb()
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
