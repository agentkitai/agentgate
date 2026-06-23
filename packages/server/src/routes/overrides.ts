// @agentgate/server - Override routes for dynamic policy overrides

import { Hono } from "hono";
import { nanoid } from "nanoid";
import { eq, and, gt, lt, isNull, or, not } from "drizzle-orm";
import type { OverrideAction } from "@agentgate/core";
import { getDb, overrides } from "../db/index.js";

const overridesRouter = new Hono();

/** Override actions, weakest→strongest. `deny` hard-blocks; `require_approval`
 *  escalates a tool call / request to the human approval flow. */
const OVERRIDE_ACTIONS: readonly OverrideAction[] = ["require_approval", "deny"];

// Validation helper
function validateCreateOverrideBody(body: unknown): {
  valid: boolean;
  error?: string;
  data?: {
    agentId: string;
    toolPattern: string;
    action: OverrideAction;
    reason?: string;
    ttlSeconds?: number;
  };
} {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body required" };
  }

  const b = body as Record<string, unknown>;

  if (typeof b.agentId !== "string" || !b.agentId.trim()) {
    return { valid: false, error: "agentId is required and must be a non-empty string" };
  }

  if (typeof b.toolPattern !== "string" || !b.toolPattern.trim()) {
    return { valid: false, error: "toolPattern is required and must be a non-empty string" };
  }

  if (b.toolPattern.length > 256) {
    return { valid: false, error: "toolPattern must be at most 256 characters" };
  }

  if (!OVERRIDE_ACTIONS.includes(b.action as OverrideAction)) {
    return { valid: false, error: 'action must be "require_approval" or "deny"' };
  }

  const reason = typeof b.reason === "string" ? b.reason : undefined;

  let ttlSeconds: number | undefined;
  if (b.ttlSeconds !== undefined) {
    if (typeof b.ttlSeconds !== "number" || b.ttlSeconds <= 0 || !Number.isFinite(b.ttlSeconds)) {
      return { valid: false, error: "ttlSeconds must be a positive number" };
    }
    ttlSeconds = b.ttlSeconds;
  }

  return {
    valid: true,
    data: {
      agentId: b.agentId.trim(),
      toolPattern: b.toolPattern.trim(),
      action: b.action as OverrideAction,
      reason,
      ttlSeconds,
    },
  };
}

// POST /api/overrides - Create override
overridesRouter.post("/", async (c) => {
  const body = await c.req.json();
  const validation = validateCreateOverrideBody(body);

  if (!validation.valid) {
    return c.json({ error: validation.error }, 400);
  }

  const { agentId, toolPattern, action, reason, ttlSeconds } = validation.data!;
  const id = nanoid();
  const now = new Date();
  const expiresAt = ttlSeconds ? new Date(now.getTime() + ttlSeconds * 1000) : null;

  await getDb().insert(overrides).values({
    id,
    agentId,
    toolPattern,
    action,
    reason: reason || null,
    createdAt: now,
    expiresAt,
  });

  return c.json(
    {
      id,
      agentId,
      toolPattern,
      action,
      reason: reason || null,
      createdAt: now.toISOString(),
      expiresAt: expiresAt?.toISOString() || null,
    },
    201
  );
});

// GET /api/overrides - List active (non-expired) overrides
overridesRouter.get("/", async (c) => {
  const now = new Date();

  const activeOverrides = await getDb()
    .select()
    .from(overrides)
    .where(
      or(
        isNull(overrides.expiresAt),
        gt(overrides.expiresAt, now)
      )
    );

  return c.json({
    overrides: activeOverrides.map((o) => ({
      id: o.id,
      agentId: o.agentId,
      toolPattern: o.toolPattern,
      action: o.action,
      reason: o.reason,
      createdAt: o.createdAt.toISOString(),
      expiresAt: o.expiresAt?.toISOString() || null,
    })),
  });
});

// DELETE /api/overrides/:id - Remove override
overridesRouter.delete("/:id", async (c) => {
  const { id } = c.req.param();

  const existing = await getDb()
    .select()
    .from(overrides)
    .where(eq(overrides.id, id))
    .limit(1);

  if (existing.length === 0) {
    return c.json({ error: "Override not found" }, 404);
  }

  await getDb().delete(overrides).where(eq(overrides.id, id));

  return c.json({ success: true, id });
});

export default overridesRouter;

// ─── Override matching for policy evaluation ─────────────────────────

/**
 * Check if a tool name matches a tool pattern.
 * Supports exact match and glob-style wildcards (*).
 */
export function matchToolPattern(tool: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (!pattern.includes("*")) return tool === pattern;

  // Escape regex special chars, then convert glob * to .*
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regexStr = "^" + escaped.replace(/\*/g, ".*") + "$";
  return new RegExp(regexStr).test(tool);
}

/**
 * Check overrides for a given agent and tool. Returns the matching override
 * (null if none). When several overrides match, a `deny` wins over a
 * `require_approval` — the stronger guardrail takes precedence.
 */
export async function checkOverrides(
  agentId: string,
  tool: string
): Promise<{ action: OverrideAction; reason: string | null; overrideId: string } | null> {
  const now = new Date();

  const activeOverrides = await getDb()
    .select()
    .from(overrides)
    .where(
      and(
        eq(overrides.agentId, agentId),
        or(
          isNull(overrides.expiresAt),
          gt(overrides.expiresAt, now)
        )
      )
    );

  let match: { action: OverrideAction; reason: string | null; overrideId: string } | null = null;
  for (const override of activeOverrides) {
    if (!matchToolPattern(tool, override.toolPattern)) continue;
    const candidate = {
      action: override.action,
      reason: override.reason,
      overrideId: override.id,
    };
    if (candidate.action === "deny") return candidate; // strongest — short-circuit
    match ??= candidate; // remember the first require_approval, keep scanning for a deny
  }

  return match;
}

// ─── Background cleanup ─────────────────────────────────────────────

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start background cleanup of expired overrides every 60 seconds.
 */
export function startOverrideCleanup(): void {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(async () => {
    try {
      const now = new Date();
      await getDb()
        .delete(overrides)
        .where(
          and(
            not(isNull(overrides.expiresAt)),
            lt(overrides.expiresAt, now)
          )
        );
    } catch {
      // Silently ignore cleanup errors
    }
  }, 60_000);

  // Don't block process exit
  cleanupInterval.unref();
}

/**
 * Stop background cleanup.
 */
export function stopOverrideCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
