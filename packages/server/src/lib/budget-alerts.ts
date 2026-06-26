// @agentkitai/agentgate-server — Per-agent budget threshold alerts (#13 near-limit hook).
//
// Fires a notification when an agent's current-month spend crosses a utilization
// threshold (80% = near-limit warning, 100% = exceeded). Decoupled from hard
// enforcement: an operator can get near-limit alerts via AGENT_BUDGET_ALERTS
// without flipping on AGENT_BUDGET_ENFORCEMENT. Dedup is per (agent, month,
// threshold) so an agent sitting over a threshold is notified once, not on every
// request. Reads spend from the same BudgetVerdict the enforcement path computes,
// so it fails closed-to-quiet on a telemetry outage (verdict reports 0 spend).

import { EventNames, createBaseEvent, type BudgetThresholdEvent } from "@agentkitai/agentgate-core";
import type { BudgetVerdict } from "./agent-budget.js";
import { getGlobalDispatcher } from "./notification/index.js";

// ponytail: 80%/100% hardcoded — the roadmap's two bands. Add an
// AGENT_BUDGET_ALERT_THRESHOLDS env var if anyone needs custom bands.
const THRESHOLDS = [0.8, 1.0] as const;

// Dedup state for the CURRENT month only; cleared when the UTC month rolls over
// (spend resets then too — see currentMonthWindow in agent-spend), which bounds
// it to ~2 entries per active agent.
// ponytail: in-memory, per-instance. Not shared across replicas and reset on
// restart → an alert may re-fire after a deploy or fire once per replica. Fine
// for a soft notification; persist to a table if exactly-once across the fleet
// matters.
let alerted = new Set<string>();
let alertedPeriod = "";

function currentPeriod(now: Date): string {
  return `${now.getUTCFullYear()}-${now.getUTCMonth()}`;
}

/** @internal Reset dedup state — testing only. */
export function resetBudgetAlerts(): void {
  alerted = new Set();
  alertedPeriod = "";
}

/**
 * Emit a `budget.threshold` notification if `verdict` shows the agent newly
 * crossed the highest configured threshold this month. No-op when the agent has
 * no budget, hasn't crossed a threshold, or already alerted for that threshold.
 * Fire-and-forget (uses the dispatcher's own fail-silently delivery).
 */
export function maybeAlertBudgetThreshold(
  agentId: string,
  verdict: BudgetVerdict,
  tenantId: string,
  now = new Date(),
): void {
  const { limitUsd, spentUsd } = verdict;
  if (limitUsd === null || limitUsd <= 0) return;

  const utilization = spentUsd / limitUsd;
  // Highest crossed band — a jump from 0 to 150% alerts "exceeded", not "near".
  let crossed: number | null = null;
  for (const t of THRESHOLDS) if (utilization >= t) crossed = t;
  if (crossed === null) return;

  const period = currentPeriod(now);
  if (period !== alertedPeriod) {
    alerted = new Set();
    alertedPeriod = period;
  }
  // Key on tenant too: spend is summed per tenant (see fetchAgentSpend), and the
  // same agent id can serve multiple tenants with independent caps — keying on
  // agentId alone would let one tenant's alert suppress another's.
  const key = `${tenantId}:${agentId}:${crossed}`;
  if (alerted.has(key)) return;
  alerted.add(key);

  const event: BudgetThresholdEvent = {
    ...createBaseEvent(EventNames.BUDGET_THRESHOLD, "server"),
    payload: { agentId, tenantId, threshold: crossed, utilization, spentUsd, limitUsd },
  };
  getGlobalDispatcher().dispatchSync(event);
}
