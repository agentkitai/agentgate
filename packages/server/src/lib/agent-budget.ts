// @agentgate/server — Per-agent budget enforcement (#13).
//
// Compares an agent's current-month spend (read from AgentLens via
// lib/agent-spend) against its configured monthly USD cap. This is a SOFT
// guardrail: it gates the NEXT request once an agent is over budget — it cannot
// stop in-flight LLM spend (AgentGate doesn't sit in the completion path), and
// spend is cache-stale by up to the spend cache TTL. It also FAILS OPEN: if the
// limit can't be evaluated (AgentLens unconfigured or unreachable) the request
// is allowed, never blocked on a telemetry outage.

import { getAgentBudget } from "./agents.js";
import { fetchAgentSpend, currentMonthWindow, SpendNotConfiguredError } from "./agent-spend.js";
import { getLogger } from "./logger.js";

// Near the cap the 30s-cached spend is too stale to gate on, so re-read with a
// tight freshness budget. ponytail: 0.8 / 2s hardcoded — the issue's "> 80%"
// band; make them config if an operator needs to tune the soft-cap tightness.
const NEAR_CAP_FRACTION = 0.8;
const NEAR_CAP_MAX_AGE_MS = 2000;

export interface BudgetVerdict {
  allowed: boolean;
  /** The agent's cap, or null if it has no budget. */
  limitUsd: number | null;
  /** Current-month spend used for the decision. */
  spentUsd: number;
}

/**
 * Whether `agentId` is within its monthly budget. Agents with no cap are always
 * allowed. Fails open (allowed) when spend can't be read.
 */
export async function checkAgentBudget(agentId: string, tenantId: string): Promise<BudgetVerdict> {
  const limitUsd = await getAgentBudget(agentId);
  if (limitUsd === null) return { allowed: true, limitUsd: null, spentUsd: 0 };

  // Pin one window for both reads so they share a cache key (the key buckets the
  // window end into 30s slots — recomputing per read could straddle a boundary).
  const window = currentMonthWindow();

  let spentUsd = 0;
  try {
    spentUsd = (await fetchAgentSpend([agentId], tenantId, window)).get(agentId) ?? 0;
  } catch (err) {
    // Fail open: a budget guardrail must never block requests because the
    // telemetry source is down or unconfigured.
    if (!(err instanceof SpendNotConfiguredError)) {
      getLogger().warn({ err, agentId }, "agent budget check failed; allowing (fail-open)");
    }
    return { allowed: true, limitUsd, spentUsd: 0 };
  }

  // Near the cap, re-read with a tight freshness budget so the gate sees current
  // spend, not up-to-30s-stale spend (the main staleness-tightening — a stale
  // cached value from a PRIOR request gets refreshed here). The small maxAge also
  // reuses a just-written entry, so a cold read isn't fetched twice. A failure on
  // THIS read keeps the first read's value (already valid) rather than failing
  // open — we only fail open when telemetry is unreachable (the catch above).
  if (spentUsd >= limitUsd * NEAR_CAP_FRACTION) {
    try {
      spentUsd = (await fetchAgentSpend([agentId], tenantId, window, NEAR_CAP_MAX_AGE_MS)).get(agentId) ?? spentUsd;
    } catch (err) {
      getLogger().warn({ err, agentId }, "near-cap spend re-read failed; using cached spend");
    }
  }

  return { allowed: spentUsd < limitUsd, limitUsd, spentUsd };
}
