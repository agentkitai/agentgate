// @agentgate/server - Escalation rules and history routes

import { Hono } from "hono";
import { nanoid } from "nanoid";
import { eq, desc } from "drizzle-orm";
import { getDb, escalationRules, escalationHistory } from "../db/index.js";

const escalationsRouter = new Hono();

// ─── Validation helpers ──────────────────────────────────────────────

function validateCreateRuleBody(body: unknown): {
  valid: boolean;
  error?: string;
  data?: {
    policyId: string | null;
    triggerAfterSec: number;
    escalateTo: string;
    priority: number;
    enabled: number;
  };
} {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body required" };
  }

  const b = body as Record<string, unknown>;

  if (typeof b.escalateTo !== "string" || !b.escalateTo.trim()) {
    return { valid: false, error: "escalateTo is required and must be a non-empty string (format: 'channel:target')" };
  }

  const policyId = typeof b.policyId === "string" ? b.policyId.trim() || null : null;

  let triggerAfterSec = 1800; // default 30 minutes
  if (b.triggerAfterSec !== undefined) {
    if (typeof b.triggerAfterSec !== "number" || b.triggerAfterSec <= 0 || !Number.isFinite(b.triggerAfterSec)) {
      return { valid: false, error: "triggerAfterSec must be a positive number" };
    }
    triggerAfterSec = Math.floor(b.triggerAfterSec);
  }

  let priority = 0;
  if (b.priority !== undefined) {
    if (typeof b.priority !== "number" || !Number.isFinite(b.priority)) {
      return { valid: false, error: "priority must be a number" };
    }
    priority = Math.floor(b.priority);
  }

  let enabled = 1;
  if (b.enabled !== undefined) {
    if (typeof b.enabled === "boolean") {
      enabled = b.enabled ? 1 : 0;
    } else if (b.enabled === 0 || b.enabled === 1) {
      enabled = b.enabled;
    } else {
      return { valid: false, error: "enabled must be a boolean or 0/1" };
    }
  }

  return {
    valid: true,
    data: {
      policyId,
      triggerAfterSec,
      escalateTo: b.escalateTo.trim(),
      priority,
      enabled,
    },
  };
}

// ─── Routes ──────────────────────────────────────────────────────────

// GET /api/escalation-rules — list rules (with pagination)
escalationsRouter.get("/escalation-rules", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const rules = await getDb()
    .select()
    .from(escalationRules)
    .orderBy(desc(escalationRules.priority))
    .limit(limit)
    .offset(offset);

  return c.json({
    rules: rules.map((r) => ({
      id: r.id,
      policyId: r.policyId,
      triggerAfterSec: r.triggerAfterSec,
      escalateTo: r.escalateTo,
      priority: r.priority,
      enabled: r.enabled,
      createdAt: r.createdAt,
    })),
    limit,
    offset,
  });
});

// POST /api/escalation-rules — create rule
escalationsRouter.post("/escalation-rules", async (c) => {
  const body = await c.req.json();
  const validation = validateCreateRuleBody(body);

  if (!validation.valid) {
    return c.json({ error: validation.error }, 400);
  }

  const { policyId, triggerAfterSec, escalateTo, priority, enabled } = validation.data!;
  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);

  await getDb().insert(escalationRules).values({
    id,
    policyId,
    triggerAfterSec,
    escalateTo,
    priority,
    enabled,
    createdAt: now,
  });

  return c.json(
    {
      id,
      policyId,
      triggerAfterSec,
      escalateTo,
      priority,
      enabled,
      createdAt: now,
    },
    201
  );
});

// PUT /api/escalation-rules/:id — update rule
escalationsRouter.put("/escalation-rules/:id", async (c) => {
  const { id } = c.req.param();

  const existing = await getDb()
    .select()
    .from(escalationRules)
    .where(eq(escalationRules.id, id))
    .limit(1);

  if (existing.length === 0) {
    return c.json({ error: "Escalation rule not found" }, 404);
  }

  const body = await c.req.json();
  const b = body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};

  if (typeof b.policyId === "string") {
    updates.policyId = b.policyId.trim() || null;
  } else if (b.policyId === null) {
    updates.policyId = null;
  }

  if (b.triggerAfterSec !== undefined) {
    if (typeof b.triggerAfterSec !== "number" || b.triggerAfterSec <= 0 || !Number.isFinite(b.triggerAfterSec)) {
      return c.json({ error: "triggerAfterSec must be a positive number" }, 400);
    }
    updates.triggerAfterSec = Math.floor(b.triggerAfterSec);
  }

  if (typeof b.escalateTo === "string") {
    if (!b.escalateTo.trim()) {
      return c.json({ error: "escalateTo must be a non-empty string" }, 400);
    }
    updates.escalateTo = b.escalateTo.trim();
  }

  if (b.priority !== undefined) {
    if (typeof b.priority !== "number" || !Number.isFinite(b.priority)) {
      return c.json({ error: "priority must be a number" }, 400);
    }
    updates.priority = Math.floor(b.priority);
  }

  if (b.enabled !== undefined) {
    if (typeof b.enabled === "boolean") {
      updates.enabled = b.enabled ? 1 : 0;
    } else if (b.enabled === 0 || b.enabled === 1) {
      updates.enabled = b.enabled;
    } else {
      return c.json({ error: "enabled must be a boolean or 0/1" }, 400);
    }
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No valid fields to update" }, 400);
  }

  await getDb()
    .update(escalationRules)
    .set(updates)
    .where(eq(escalationRules.id, id));

  // Re-fetch updated rule
  const updatedRows = await getDb()
    .select()
    .from(escalationRules)
    .where(eq(escalationRules.id, id))
    .limit(1);

  const updated = updatedRows[0]!;

  return c.json({
    id: updated.id,
    policyId: updated.policyId,
    triggerAfterSec: updated.triggerAfterSec,
    escalateTo: updated.escalateTo,
    priority: updated.priority,
    enabled: updated.enabled,
    createdAt: updated.createdAt,
  });
});

// DELETE /api/escalation-rules/:id — delete rule
escalationsRouter.delete("/escalation-rules/:id", async (c) => {
  const { id } = c.req.param();

  const existing = await getDb()
    .select()
    .from(escalationRules)
    .where(eq(escalationRules.id, id))
    .limit(1);

  if (existing.length === 0) {
    return c.json({ error: "Escalation rule not found" }, 404);
  }

  await getDb().delete(escalationRules).where(eq(escalationRules.id, id));

  return c.json({ success: true, id });
});

// GET /api/requests/:id/escalation-history — history for a request
escalationsRouter.get("/requests/:id/escalation-history", async (c) => {
  const { id } = c.req.param();

  const history = await getDb()
    .select()
    .from(escalationHistory)
    .where(eq(escalationHistory.requestId, id))
    .orderBy(desc(escalationHistory.escalatedAt));

  return c.json({
    history: history.map((h) => ({
      id: h.id,
      requestId: h.requestId,
      ruleId: h.ruleId,
      escalatedAt: h.escalatedAt,
      fromChannel: h.fromChannel,
      toChannel: h.toChannel,
    })),
  });
});

export default escalationsRouter;
