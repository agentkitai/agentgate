// @agentgate/server — Reactive guardrails
//
// Folds in the former standalone `agentkit-guardrails` service. AgentLens monitors
// agent metrics (error rate, latency, token usage, …) and POSTs a breach/recovery
// webhook here. On breach we create a policy override that requires approval for the
// configured tools; on recovery we remove it. The override also carries a TTL so a
// missed recovery webhook still expires (AgentGate's override cleanup deletes it).
//
// AgentGate's override model is `require_approval`-only, so that is the action.
// The endpoint is authenticated by a shared secret (fail closed if unset), like a
// webhook — it is mounted before the user-auth middleware.

import { Hono } from "hono";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { getDb, overrides } from "../db/index.js";
import { getAgentIfActive } from "../lib/agents.js";
import { notifyLensOfBreach } from "../lib/lens-breach.js";

type Db = ReturnType<typeof getDb>;

export interface GuardrailRule {
  /** AgentLens metric name, e.g. "error_rate", "latency_p99". */
  metric: string;
  /** Glob of tools to gate while the metric is breached (e.g. "*", "external_api.*"). */
  toolPattern: string;
  /** Override auto-expires after this many seconds (safety net for a missed recovery). */
  ttlSeconds?: number;
  /** Human-readable reason recorded on the override. */
  reason?: string;
}

interface WebhookPayload {
  event: "breach" | "recovery";
  metric: string;
  agentId: string;
  /** Optional AgentLens session the breach occurred in; when present, the breach
   *  is mirrored into that session's tamper-evident audit trail (#55). */
  sessionId?: string;
}

/** Parse rules from the GUARDRAILS_RULES env var (a JSON array of GuardrailRule). */
export function loadRulesFromEnv(): GuardrailRule[] {
  const raw = process.env.GUARDRAILS_RULES;
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as GuardrailRule[]) : [];
  } catch {
    return [];
  }
}

export function matchRule(metric: string, rules: GuardrailRule[]): GuardrailRule | undefined {
  return rules.find((r) => r.metric === metric);
}

function overrideKey(agentId: string, metric: string): string {
  return `${agentId}::${metric}`;
}

/**
 * Tracks the override id created for each (agent, metric) breach so the matching
 * recovery webhook can remove it. A per-entry timer drops the in-memory mapping
 * after the rule's TTL even if no recovery arrives (the DB override expires
 * independently via the override cleanup loop).
 */
export class OverrideTracker {
  private map = new Map<string, string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  set(key: string, id: string, ttlSeconds?: number): void {
    this.clearTimer(key);
    this.map.set(key, id);
    if (ttlSeconds && ttlSeconds > 0) {
      const t = setTimeout(() => {
        this.map.delete(key);
        this.timers.delete(key);
      }, ttlSeconds * 1000);
      if (typeof t === "object" && "unref" in t) t.unref();
      this.timers.set(key, t);
    }
  }

  take(key: string): string | undefined {
    const id = this.map.get(key);
    if (id !== undefined) {
      this.map.delete(key);
      this.clearTimer(key);
    }
    return id;
  }

  private clearTimer(key: string): void {
    const t = this.timers.get(key);
    if (t) {
      clearTimeout(t);
      this.timers.delete(key);
    }
  }
}

/** On breach: create a require-approval override for the rule's tools. Returns the override id. */
export async function applyBreach(
  db: Db,
  rule: GuardrailRule,
  agentId: string,
  tracker: OverrideTracker,
): Promise<string> {
  const id = nanoid();
  const now = new Date();
  const expiresAt = rule.ttlSeconds ? new Date(now.getTime() + rule.ttlSeconds * 1000) : null;
  await db.insert(overrides).values({
    id,
    agentId,
    toolPattern: rule.toolPattern,
    action: "require_approval",
    reason: rule.reason ?? `AgentLens metric "${rule.metric}" breached`,
    createdAt: now,
    expiresAt,
  });
  tracker.set(overrideKey(agentId, rule.metric), id, rule.ttlSeconds);
  return id;
}

/** On recovery: remove the override created for this (agent, metric), if any. Returns the removed id. */
export async function applyRecovery(
  db: Db,
  agentId: string,
  metric: string,
  tracker: OverrideTracker,
): Promise<string | null> {
  const id = tracker.take(overrideKey(agentId, metric));
  if (id === undefined) return null;
  await db.delete(overrides).where(eq(overrides.id, id));
  return id;
}

/**
 * Router for the AgentLens reactive-guardrails webhook.
 * Mount before the user-auth middleware; it authenticates with a shared secret.
 */
export function createGuardrailsRouter(opts?: {
  secret?: string;
  rules?: GuardrailRule[];
  tracker?: OverrideTracker;
}) {
  const secret = opts?.secret ?? process.env.GUARDRAILS_WEBHOOK_SECRET;
  const rules = opts?.rules ?? loadRulesFromEnv();
  const tracker = opts?.tracker ?? new OverrideTracker();
  const router = new Hono();

  // POST /api/guardrails/webhook — AgentLens breach/recovery alert.
  router.post("/webhook", async (c) => {
    // Fail closed: reject everything if no secret is configured.
    if (!secret || c.req.header("x-guardrails-secret") !== secret) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const body = (await c.req.json().catch(() => null)) as Partial<WebhookPayload> | null;
    if (
      !body ||
      (body.event !== "breach" && body.event !== "recovery") ||
      typeof body.metric !== "string" ||
      typeof body.agentId !== "string"
    ) {
      return c.json({ error: "invalid payload" }, 400);
    }

    const rule = matchRule(body.metric, rules);
    if (!rule) return c.json({ status: "ignored", reason: "no matching rule" }, 200);

    if (body.event === "breach") {
      // Agent-identity check (#12): body.agentId is supplied by AgentLens and is
      // NOT cryptographically verified here, so only gate agents that resolve to
      // a registered, active entry in the agent registry (the agentlens.agentId
      // == agt_* join convention makes this the same id). This skips creating
      // overrides for unknown or revoked agents. Recovery needs no such check —
      // it only removes an override this process tracked.
      //
      // Fail OPEN on a registry-lookup error: a guardrail breach should still
      // gate the agent during a transient DB error rather than 500 — the worst
      // case is a stray override that is inert (checkOverrides keys on the
      // VERIFIED agent id) and TTL-expires anyway.
      let knownActive = true;
      try {
        knownActive = (await getAgentIfActive(body.agentId)) !== null;
      } catch {
        knownActive = true;
      }
      if (!knownActive) {
        return c.json({ status: "ignored", reason: "unknown or revoked agent" }, 200);
      }
      const id = await applyBreach(getDb(), rule, body.agentId, tracker);
      // Mirror the breach into AgentLens when the caller correlated it to a
      // session (#55). Fire-and-forget + fail-open.
      if (typeof body.sessionId === "string" && body.sessionId.length > 0) {
        void notifyLensOfBreach({
          sessionId: body.sessionId,
          agentId: body.agentId,
          ruleId: rule.metric,
          ruleType: "reactive_guardrail",
          tool: rule.toolPattern,
          reason: rule.reason ?? `AgentLens metric "${rule.metric}" breached`,
          source: "reactive_guardrail",
        }).catch(() => {});
      }
      return c.json({ status: "override_created", overrideId: id }, 200);
    }

    const removed = await applyRecovery(getDb(), body.agentId, body.metric, tracker);
    return c.json(
      removed
        ? { status: "override_removed", overrideId: removed }
        : { status: "ignored", reason: "no active override" },
      200,
    );
  });

  return router;
}

export default createGuardrailsRouter;
