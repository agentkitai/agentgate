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
import { fetchAgentSpend, SpendNotConfiguredError } from "./agent-spend.js";
import { getLogger } from "./logger.js";

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

  let spentUsd = 0;
  try {
    spentUsd = (await fetchAgentSpend([agentId], tenantId)).get(agentId) ?? 0;
  } catch (err) {
    // Fail open: a budget guardrail must never block requests because the
    // telemetry source is down or unconfigured.
    if (!(err instanceof SpendNotConfiguredError)) {
      getLogger().warn({ err, agentId }, "agent budget check failed; allowing (fail-open)");
    }
    return { allowed: true, limitUsd, spentUsd: 0 };
  }

  return { allowed: spentUsd < limitUsd, limitUsd, spentUsd };
}
