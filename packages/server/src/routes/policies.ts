// @agentkitai/agentgate-server - Policy routes

import { Hono } from "hono";
import { nanoid } from "nanoid";
import { eq, sql, and, gte, lte } from "drizzle-orm";
import isSafeRegex from "safe-regex2";
import { getDb, policies, approvalRequests } from "../db/index.js";
import type { PolicyRule, Policy, PolicyScope, ApprovalRequest } from "@agentkitai/agentgate-core";
import { evaluatePolicy } from "@agentkitai/agentgate-core";
import { invalidatePolicyCache } from "../lib/policy-cache.js";
import { getTemplates, getTemplateById } from "../lib/policy-templates.js";

const policiesRouter = new Hono();

// Validation helpers
function validatePolicyBody(body: unknown): {
  valid: boolean;
  error?: string;
  data?: {
    name: string;
    rules: PolicyRule[];
    priority: number;
    enabled: boolean;
    scope: PolicyScope;
    agentIds?: string[];
    toolIds?: string[];
  };
} {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body required" };
  }

  const b = body as Record<string, unknown>;

  if (typeof b.name !== "string" || !b.name.trim()) {
    return { valid: false, error: "name is required and must be a non-empty string" };
  }

  if (!Array.isArray(b.rules)) {
    return { valid: false, error: "rules is required and must be an array" };
  }

  // Validate each rule
  for (let i = 0; i < b.rules.length; i++) {
    const rule = b.rules[i];
    if (!rule || typeof rule !== "object") {
      return { valid: false, error: `rules[${i}] must be an object` };
    }
    if (!rule.match || typeof rule.match !== "object") {
      return { valid: false, error: `rules[${i}].match is required and must be an object` };
    }
    if (!["auto_approve", "auto_deny", "route_to_human", "route_to_agent"].includes(rule.decision)) {
      return {
        valid: false,
        error: `rules[${i}].decision must be one of: auto_approve, auto_deny, route_to_human, route_to_agent`,
      };
    }

    // Validate regex matchers for ReDoS safety
    for (const [key, matcher] of Object.entries(rule.match)) {
      if (typeof matcher === "object" && matcher !== null && "$regex" in matcher) {
        const regexMatcher = matcher as { $regex: string };
        if (!isSafeRegex(regexMatcher.$regex)) {
          return {
            valid: false,
            error: `Unsafe regex in rule matcher for "${key}": ${regexMatcher.$regex}`,
          };
        }
      }
    }
  }

  const priority = typeof b.priority === "number" ? b.priority : 100;
  const enabled = typeof b.enabled === "boolean" ? b.enabled : true;

  // Scope (issue #13). Defaults to "global" for backward compatibility.
  const scope = b.scope === undefined ? "global" : b.scope;
  if (scope !== "global" && scope !== "per_agent" && scope !== "per_tool") {
    return { valid: false, error: "scope must be one of: global, per_agent, per_tool" };
  }

  const isStringArray = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((x) => typeof x === "string");

  if (b.agentIds !== undefined && b.agentIds !== null && !isStringArray(b.agentIds)) {
    return { valid: false, error: "agentIds must be an array of strings" };
  }
  if (b.toolIds !== undefined && b.toolIds !== null && !isStringArray(b.toolIds)) {
    return { valid: false, error: "toolIds must be an array of strings" };
  }
  const agentIds = isStringArray(b.agentIds) ? b.agentIds : undefined;
  const toolIds = isStringArray(b.toolIds) ? b.toolIds : undefined;

  // A scoped policy that names nobody applies to nobody — reject as misconfig
  // rather than silently widening it back to global.
  if (scope === "per_agent" && !agentIds?.length) {
    return { valid: false, error: "scope 'per_agent' requires a non-empty agentIds" };
  }
  if (scope === "per_tool" && !toolIds?.length) {
    return { valid: false, error: "scope 'per_tool' requires a non-empty toolIds" };
  }

  return {
    valid: true,
    data: {
      name: b.name.trim(),
      rules: b.rules as PolicyRule[],
      priority,
      enabled,
      scope,
      agentIds,
      toolIds,
    },
  };
}

// GET /api/policies - List policies with pagination
policiesRouter.get("/", async (c) => {
  const limit = Math.max(1, Math.min(parseInt(c.req.query("limit") || "50", 10) || 50, 100));
  const offset = Math.max(0, parseInt(c.req.query("offset") || "0", 10) || 0);

  const allPolicies = await getDb()
    .select()
    .from(policies)
    .orderBy(policies.priority)
    .limit(limit)
    .offset(offset);

  // Get total count
  const countResult = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(policies);
  const total = Number(countResult[0]?.count) || 0;

  // Parse JSON columns so the list matches the POST/PUT response shape (arrays,
  // not raw JSON strings).
  const parsed = allPolicies.map((p) => ({
    ...p,
    rules: JSON.parse(p.rules) as PolicyRule[],
    agentIds: p.agentIds ? (JSON.parse(p.agentIds) as string[]) : null,
    toolIds: p.toolIds ? (JSON.parse(p.toolIds) as string[]) : null,
  }));

  return c.json({
    policies: parsed,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + allPolicies.length < total,
    },
  });
});

// POST /api/policies - Create policy
policiesRouter.post("/", async (c) => {
  const body = await c.req.json();
  const validation = validatePolicyBody(body);

  if (!validation.valid) {
    return c.json({ error: validation.error }, 400);
  }

  const { name, rules, priority, enabled, scope, agentIds, toolIds } = validation.data!;
  const id = nanoid();
  const now = new Date();

  await getDb().insert(policies).values({
    id,
    name,
    rules: JSON.stringify(rules),
    priority,
    enabled,
    scope,
    agentIds: agentIds ? JSON.stringify(agentIds) : null,
    toolIds: toolIds ? JSON.stringify(toolIds) : null,
    createdAt: now,
  });

  invalidatePolicyCache();

  return c.json(
    {
      id,
      name,
      rules,
      priority,
      enabled,
      scope,
      agentIds: agentIds ?? null,
      toolIds: toolIds ?? null,
      createdAt: now.toISOString(),
    },
    201
  );
});

// GET /api/policies/templates - List policy templates
policiesRouter.get("/templates", async (c) => {
  return c.json({ templates: getTemplates() });
});

// POST /api/policies/from-template - Create a policy from a template
policiesRouter.post("/from-template", async (c) => {
  const body = await c.req.json();
  const { templateId, overrides } = body as {
    templateId?: string;
    overrides?: { name?: string; priority?: number; enabled?: boolean };
  };

  if (!templateId || typeof templateId !== "string") {
    return c.json({ error: "templateId is required" }, 400);
  }

  const template = getTemplateById(templateId);
  if (!template) {
    return c.json({ error: `Template not found: ${templateId}` }, 404);
  }

  const name = overrides?.name ?? template.name;
  const priority = overrides?.priority ?? template.priority;
  const enabled = overrides?.enabled ?? true;
  const rules = template.rules;

  const id = nanoid();
  const now = new Date();

  await getDb().insert(policies).values({
    id,
    name,
    rules: JSON.stringify(rules),
    priority,
    enabled,
    createdAt: now,
  });

  invalidatePolicyCache();

  return c.json(
    {
      id,
      name,
      rules,
      priority,
      enabled,
      createdAt: now.toISOString(),
      templateId,
    },
    201
  );
});

// POST /api/policies/simulate - Simulate a candidate policy against historical requests
policiesRouter.post("/simulate", async (c) => {
  const body = await c.req.json();
  const { rules, priority, from, to, limit, scope, agentIds, toolIds } = body as {
    rules?: PolicyRule[];
    priority?: number;
    from?: string;
    to?: string;
    limit?: number;
    scope?: PolicyScope;
    agentIds?: string[];
    toolIds?: string[];
  };

  if (!Array.isArray(rules) || rules.length === 0) {
    return c.json({ error: "rules is required and must be a non-empty array" }, 400);
  }

  // Validate rules
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (!rule || typeof rule !== "object" || !rule.match || typeof rule.match !== "object") {
      return c.json({ error: `rules[${i}].match is required and must be an object` }, 400);
    }
    if (!["auto_approve", "auto_deny", "route_to_human", "route_to_agent"].includes(rule.decision)) {
      return c.json({
        error: `rules[${i}].decision must be one of: auto_approve, auto_deny, route_to_human, route_to_agent`,
      }, 400);
    }
  }

  const queryLimit = Math.max(1, Math.min(limit || 100, 500));

  // Build date filters
  const conditions = [];
  if (from) {
    conditions.push(gte(approvalRequests.createdAt, new Date(from)));
  }
  if (to) {
    conditions.push(lte(approvalRequests.createdAt, new Date(to)));
  }

  // Load historical requests
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const historicalRows = await getDb()
    .select()
    .from(approvalRequests)
    .where(whereClause)
    .orderBy(approvalRequests.createdAt)
    .limit(queryLimit);

  // Build candidate policy. Carry scope so the preview matches enforcement.
  const candidatePolicy: Policy = {
    id: "__simulation__",
    name: "Simulation Candidate",
    rules,
    priority: typeof priority === "number" ? priority : 0,
    enabled: true,
    scope: scope ?? "global",
    agentIds: Array.isArray(agentIds) ? agentIds : undefined,
    toolIds: Array.isArray(toolIds) ? toolIds : undefined,
  };

  // Load current active policies (with their scope, so scoped policies are
  // filtered exactly as the enforcement path would, not treated as global).
  const currentPolicyRows = await getDb()
    .select()
    .from(policies)
    .orderBy(policies.priority);

  const currentPolicies: Policy[] = currentPolicyRows.map((p) => ({
    id: p.id,
    name: p.name,
    rules: JSON.parse(p.rules) as PolicyRule[],
    priority: p.priority,
    enabled: p.enabled,
    scope: p.scope ?? "global",
    agentIds: p.agentIds ? (JSON.parse(p.agentIds) as string[]) : undefined,
    toolIds: p.toolIds ? (JSON.parse(p.toolIds) as string[]) : undefined,
  }));

  // Evaluate each request
  const summary = { autoApproved: 0, autoDenied: 0, routedToHuman: 0 };
  let changed = 0;
  const details: Array<{
    requestId: string;
    action: string;
    candidateDecision: string;
    currentDecision: string;
    changed: boolean;
  }> = [];

  for (const row of historicalRows) {
    const request: ApprovalRequest = {
      id: row.id,
      action: row.action,
      params: row.params ? JSON.parse(row.params) : {},
      context: row.context ? JSON.parse(row.context) : {},
      status: row.status as ApprovalRequest["status"],
      urgency: row.urgency as ApprovalRequest["urgency"],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    // Scope on the same verified identity + tool the enforcement path uses.
    const evalContext = { agentId: row.verifiedAgentId, tool: row.action };
    const candidateResult = evaluatePolicy(request, [candidatePolicy], evalContext);
    const currentResult = evaluatePolicy(request, currentPolicies, evalContext);

    const isChanged = candidateResult.decision !== currentResult.decision;
    if (isChanged) changed++;

    if (candidateResult.decision === "auto_approve") summary.autoApproved++;
    else if (candidateResult.decision === "auto_deny") summary.autoDenied++;
    else summary.routedToHuman++;

    details.push({
      requestId: row.id,
      action: row.action,
      candidateDecision: candidateResult.decision,
      currentDecision: currentResult.decision,
      changed: isChanged,
    });
  }

  return c.json({
    total: historicalRows.length,
    results: summary,
    changed,
    details,
  });
});

// POST /api/policies/:id/dry-run - Dry-run a single synthetic request against a policy
policiesRouter.post("/:id/dry-run", async (c) => {
  const { id } = c.req.param();

  const existing = await getDb().select().from(policies).where(eq(policies.id, id)).limit(1);
  if (existing.length === 0) {
    return c.json({ error: "Policy not found" }, 404);
  }

  const body = await c.req.json();
  const { action, params, context, urgency } = body as {
    action?: string;
    params?: Record<string, unknown>;
    context?: Record<string, unknown>;
    urgency?: string;
  };

  if (!action || typeof action !== "string") {
    return c.json({ error: "action is required and must be a string" }, 400);
  }

  const syntheticRequest: ApprovalRequest = {
    id: "__dry_run__",
    action,
    params: params || {},
    context: context || {},
    status: "pending",
    urgency: (urgency as ApprovalRequest["urgency"]) || "normal",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const policy: Policy = {
    id: existing[0]!.id,
    name: existing[0]!.name,
    rules: JSON.parse(existing[0]!.rules) as PolicyRule[],
    priority: existing[0]!.priority,
    enabled: existing[0]!.enabled,
  };

  const result = evaluatePolicy(syntheticRequest, [policy]);

  return c.json({
    decision: result.decision,
    matchedRule: result.matchedRule || null,
    reason: result.matchedRule
      ? `Matched rule with decision "${result.decision}"`
      : "No rule matched; defaulted to route_to_human",
  });
});

// PUT /api/policies/:id - Update policy
policiesRouter.put("/:id", async (c) => {
  const { id } = c.req.param();

  // Check if policy exists
  const existing = await getDb().select().from(policies).where(eq(policies.id, id)).limit(1);

  if (existing.length === 0) {
    return c.json({ error: "Policy not found" }, 404);
  }

  const body = await c.req.json();
  const validation = validatePolicyBody(body);

  if (!validation.valid) {
    return c.json({ error: validation.error }, 400);
  }

  const { name, rules, priority, enabled, scope, agentIds, toolIds } = validation.data!;

  await getDb()
    .update(policies)
    .set({
      name,
      rules: JSON.stringify(rules),
      priority,
      enabled,
      scope,
      agentIds: agentIds ? JSON.stringify(agentIds) : null,
      toolIds: toolIds ? JSON.stringify(toolIds) : null,
    })
    .where(eq(policies.id, id));

  invalidatePolicyCache();

  return c.json({
    id,
    name,
    rules,
    priority,
    enabled,
    scope,
    agentIds: agentIds ?? null,
    toolIds: toolIds ?? null,
    createdAt: existing[0]!.createdAt,
  });
});

// DELETE /api/policies/:id - Delete policy
policiesRouter.delete("/:id", async (c) => {
  const { id } = c.req.param();

  // Check if policy exists
  const existing = await getDb().select().from(policies).where(eq(policies.id, id)).limit(1);

  if (existing.length === 0) {
    return c.json({ error: "Policy not found" }, 404);
  }

  await getDb().delete(policies).where(eq(policies.id, id));

  invalidatePolicyCache();

  return c.json({ success: true, id });
});

export default policiesRouter;
