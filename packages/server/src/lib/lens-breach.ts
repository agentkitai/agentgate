// @agentgate/server — Mirror guardrail breaches into AgentLens (#55, gate→lens wedge).
//
// When the gate denies an action, we record it in AgentLens as a hash-chained
// compliance eval_result, so the breach becomes tamper-evident audit evidence.
// This is FIRE-AND-FORGET and FAIL-OPEN: a lens outage must never affect gate
// enforcement — the worst case is the breach simply isn't mirrored. AgentGate
// holds no AgentLens session of its own, so the caller supplies the sessionId it
// observed the breach in (omit → no-op, since there's no chain to extend).

import { AgentGateHttpClient } from "@agentgate/core";
import { getConfig } from "../config.js";
import { getLogger } from "./logger.js";

export interface LensBreachInput {
  /** The AgentLens session to chain the eval_result into. No session → no-op. */
  sessionId: string;
  agentId: string;
  ruleId: string;
  ruleType?: string;
  tool?: string;
  reason?: string;
  /** Where this fired. */
  source: "mcp_guardrail" | "reactive_guardrail";
  /** AgentGate is single-tenant today → defaults to "default". */
  tenantId?: string;
}

/** A session id is a short opaque token; bound it so untrusted context can't bloat logs/storage. */
const MAX_SESSION_ID_LEN = 256;

/** Pull an AgentLens session id out of an MCP call's (untrusted) context, if the caller set one. */
export function sessionIdFromContext(context?: Record<string, unknown>): string | undefined {
  const s = context?.["agentlens_session_id"];
  return typeof s === "string" && s.length > 0 && s.length <= MAX_SESSION_ID_LEN ? s : undefined;
}

/**
 * Record a guardrail breach in AgentLens. Never throws; returns whether the
 * breach was actually sent (false = not configured / no session / send failed).
 */
export async function notifyLensOfBreach(input: LensBreachInput): Promise<boolean> {
  try {
    const config = getConfig();
    if (!config.agentlensUrl || !config.agentgateServiceToken) return false; // not wired up
    if (!input.sessionId) return false; // nothing to chain into

    const client = new AgentGateHttpClient(
      config.agentlensUrl,
      config.agentgateServiceToken,
      config.spendReadTimeoutMs,
    );
    await client.request("POST", "/api/internal/eval/guardrail-breach", {
      tenantId: input.tenantId ?? "default",
      sessionId: input.sessionId,
      agentId: input.agentId,
      breach: {
        ruleId: input.ruleId,
        ruleType: input.ruleType,
        tool: input.tool,
        reason: input.reason,
        source: input.source,
      },
    });
    getLogger().debug({ sessionId: input.sessionId, source: input.source }, "recorded guardrail breach in AgentLens");
    return true;
  } catch (err) {
    // Fail-open: enforcement already happened; the audit mirror is best-effort.
    getLogger().warn(
      { err: (err as Error).message, source: input.source },
      "failed to record guardrail breach in AgentLens (continuing)",
    );
    return false;
  }
}
