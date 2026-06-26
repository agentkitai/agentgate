// @agentgate/server — Initial decision for a new approval request.
//
// Precedence (highest first): a per-agent budget overage (#13) denies outright,
// then the per-agent eval gate (#7) denies outright, then a dynamic override
// forces human review (pending), then static policy auto-approve/deny. Anything
// else stays pending. Extracted as a pure function so the precedence is
// unit-testable without driving the whole request route.

import type { PolicyDecision } from "@agentgate/core";

export interface InitialDecision {
  status: "pending" | "approved" | "denied";
  decidedBy: string | null;
  decidedByType: "policy" | "budget_limiter" | "eval_gate" | "override";
  decidedAt: Date | null;
  decisionReason: string | null;
}

export function decideInitialStatus(input: {
  /** Non-null when the verified agent is over its budget; the reason string. */
  budgetReason: string | null;
  /** Non-null when the verified agent fails the eval gate (#7); the reason string. */
  evalReason?: string | null;
  /** A matching dynamic override, or null. `action` "deny" hard-denies; anything
   *  else (require_approval) forces human review. */
  overrideMatch: { action?: string; reason?: string | null } | null;
  policyDecision: PolicyDecision;
  /** Decision timestamp, stamped on auto-decided (approved/denied) outcomes. */
  now: Date;
}): InitialDecision {
  const { budgetReason, evalReason, overrideMatch, policyDecision, now } = input;

  if (budgetReason) {
    return {
      status: "denied",
      decidedBy: "budget",
      decidedByType: "budget_limiter",
      decidedAt: now,
      decisionReason: budgetReason,
    };
  }
  if (evalReason) {
    return {
      status: "denied",
      decidedBy: "eval_gate",
      decidedByType: "eval_gate",
      decidedAt: now,
      decisionReason: evalReason,
    };
  }
  if (overrideMatch) {
    // A `deny` override hard-denies; any other override forces human review.
    if (overrideMatch.action === "deny") {
      return {
        status: "denied",
        decidedBy: "override",
        decidedByType: "override",
        decidedAt: now,
        decisionReason: `Denied by override: ${overrideMatch.reason || "dynamic override"}`,
      };
    }
    return {
      status: "pending",
      decidedBy: null,
      decidedByType: "policy",
      decidedAt: null,
      decisionReason: `Override active: ${overrideMatch.reason || "dynamic override"}`,
    };
  }
  if (policyDecision.decision === "auto_approve") {
    return {
      status: "approved",
      decidedBy: "policy",
      decidedByType: "policy",
      decidedAt: now,
      decisionReason: policyDecision.matchedRule
        ? `Auto-approved by policy rule matching: ${JSON.stringify(policyDecision.matchedRule.match)}`
        : "Auto-approved by policy",
    };
  }
  if (policyDecision.decision === "auto_deny") {
    return {
      status: "denied",
      decidedBy: "policy",
      decidedByType: "policy",
      decidedAt: now,
      decisionReason: policyDecision.matchedRule
        ? `Auto-denied by policy rule matching: ${JSON.stringify(policyDecision.matchedRule.match)}`
        : "Auto-denied by policy",
    };
  }
  // route_to_human and route_to_agent stay pending.
  return { status: "pending", decidedBy: null, decidedByType: "policy", decidedAt: null, decisionReason: null };
}
