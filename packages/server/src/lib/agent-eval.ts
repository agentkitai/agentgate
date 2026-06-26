// @agentgate/server — Per-agent eval gate (#7).
//
// Reads an agent's latest eval pass-rate from AgentLens
// (GET /api/internal/agent-eval-status; populated by the agenteval→lens
// federation, agentlens#85) and gates the NEXT request when it's below the
// configured threshold. Like the budget gate this is a SOFT guardrail and
// FAILS OPEN: if eval status can't be read (AgentLens unconfigured/unreachable)
// or the agent has no eval evidence yet, the request is allowed — never blocked
// on a telemetry outage or an un-evaluated agent. Default-off via AGENT_EVAL_GATE.

import { AgentGateHttpClient } from "@agentgate/core";

import { getConfig } from "../config.js";
import { getLogger } from "./logger.js";

/** Thrown when AGENTLENS_URL / AGENTGATE_SERVICE_TOKEN are not configured. */
export class EvalNotConfiguredError extends Error {
  constructor() {
    super("Eval gate not configured (set AGENTLENS_URL and AGENTGATE_SERVICE_TOKEN)");
    this.name = "EvalNotConfiguredError";
  }
}

interface EvalStatusResponse {
  found?: boolean;
  passRate?: number | null;
  passedCases?: number;
  totalCases?: number;
  runId?: string;
}

export interface EvalStatus {
  found: boolean;
  passRate: number | null;
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { status: EvalStatus; at: number }>();

/** Clear the eval-status cache (testing). */
export function clearEvalCache(): void {
  cache.clear();
}

/**
 * Fetch one agent's latest completed eval status from AgentLens, cached briefly.
 * Throws EvalNotConfiguredError when AgentLens isn't configured; propagates
 * network/upstream errors to the caller (checkAgentEval fails open on them).
 */
export async function fetchAgentEvalStatus(
  agentId: string,
  tenantId: string,
  maxAgeMs = CACHE_TTL_MS,
): Promise<EvalStatus> {
  const config = getConfig();
  if (!config.agentlensUrl || !config.agentgateServiceToken) {
    throw new EvalNotConfiguredError();
  }
  const key = `${tenantId}:${agentId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.status;

  const client = new AgentGateHttpClient(config.agentlensUrl, config.agentgateServiceToken, config.spendReadTimeoutMs);
  const res = await client.request<EvalStatusResponse>(
    "GET",
    `/api/internal/agent-eval-status?agentId=${encodeURIComponent(agentId)}&tenantId=${encodeURIComponent(tenantId)}`,
  );
  const status: EvalStatus = {
    found: res?.found === true,
    passRate: typeof res?.passRate === "number" ? res.passRate : null,
  };
  cache.set(key, { status, at: Date.now() });
  return status;
}

export interface EvalVerdict {
  allowed: boolean;
  /** The agent's latest pass-rate, or null when none/unknown. */
  passRate: number | null;
  /** The configured minimum required pass-rate. */
  minPassRate: number;
}

/**
 * Whether `agentId` meets the minimum eval pass-rate. An agent with NO eval
 * evidence (never evaluated) is allowed — the gate blocks demonstrably-failing
 * agents, not un-evaluated ones. Fails open (allowed) when status can't be read.
 */
export async function checkAgentEval(agentId: string, tenantId: string): Promise<EvalVerdict> {
  const minPassRate = getConfig().agentEvalMinPassRate;
  try {
    const status = await fetchAgentEvalStatus(agentId, tenantId);
    if (!status.found || status.passRate === null) {
      return { allowed: true, passRate: status.passRate, minPassRate };
    }
    return { allowed: status.passRate >= minPassRate, passRate: status.passRate, minPassRate };
  } catch (err) {
    if (!(err instanceof EvalNotConfiguredError)) {
      getLogger().warn({ err, agentId }, "agent eval check failed; allowing (fail-open)");
    }
    return { allowed: true, passRate: null, minPassRate };
  }
}
