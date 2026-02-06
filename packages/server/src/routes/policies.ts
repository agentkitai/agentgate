// @agentgate/server - Policy routes

import { Hono } from "hono";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import isSafeRegex from "safe-regex2";
import { getDb, policies } from "../db/index.js";
import type { PolicyRule } from "@agentgate/core";

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

  return {
    valid: true,
    data: {
      name: b.name.trim(),
      rules: b.rules as PolicyRule[],
      priority,
      enabled,
    },
  };
}

// GET /api/policies - List all policies
policiesRouter.get("/", async (c) => {
  const allPolicies = await getDb().select().from(policies).orderBy(policies.priority);

  // Parse rules JSON for each policy
  const parsed = allPolicies.map((p) => ({
    ...p,
    rules: JSON.parse(p.rules) as PolicyRule[],
  }));

  return c.json(parsed);
});

// POST /api/policies - Create policy
policiesRouter.post("/", async (c) => {
  const body = await c.req.json();
  const validation = validatePolicyBody(body);

  if (!validation.valid) {
    return c.json({ error: validation.error }, 400);
  }

  const { name, rules, priority, enabled } = validation.data!;
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

  return c.json(
    {
      id,
      name,
      rules,
      priority,
      enabled,
      createdAt: now.toISOString(),
    },
    201
  );
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

  const { name, rules, priority, enabled } = validation.data!;

  await getDb()
    .update(policies)
    .set({
      name,
      rules: JSON.stringify(rules),
      priority,
      enabled,
    })
    .where(eq(policies.id, id));

  return c.json({
    id,
    name,
    rules,
    priority,
    enabled,
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

  return c.json({ success: true, id });
});

export default policiesRouter;
