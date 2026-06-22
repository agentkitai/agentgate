/**
 * decideInitialStatus — the budget > override > policy precedence (#13).
 * This is the real decision logic the requests route runs.
 */
import { describe, it, expect } from "vitest";
import type { PolicyDecision } from "@agentgate/core";
import { decideInitialStatus } from "../lib/request-decision.js";

const NOW = new Date("2026-06-22T00:00:00Z");
const approve: PolicyDecision = { decision: "auto_approve" };
const deny: PolicyDecision = { decision: "auto_deny" };
const human: PolicyDecision = { decision: "route_to_human" };
const override = { reason: "metric breach" };

function decide(over: typeof override | null, pol: PolicyDecision, budgetReason: string | null = null) {
  return decideInitialStatus({ budgetReason, overrideMatch: over, policyDecision: pol, now: NOW });
}

describe("decideInitialStatus precedence", () => {
  it("budget deny beats an auto_approve policy", () => {
    const d = decide(null, approve, "Monthly budget exceeded: $120.00 of $100.00 used");
    expect(d.status).toBe("denied");
    expect(d.decidedBy).toBe("budget");
    expect(d.decidedByType).toBe("budget_limiter");
    expect(d.decidedAt).toBe(NOW);
    expect(d.decisionReason).toContain("budget exceeded");
  });

  it("budget deny beats an active override (which would otherwise route to human)", () => {
    const d = decide(override, human, "over budget");
    expect(d.status).toBe("denied");
    expect(d.decidedByType).toBe("budget_limiter");
  });

  it("without a budget overage, an override forces pending (route to human)", () => {
    const d = decide(override, approve);
    expect(d.status).toBe("pending");
    expect(d.decidedBy).toBeNull();
    expect(d.decisionReason).toContain("Override active");
  });

  it("policy auto_approve / auto_deny apply when no budget or override", () => {
    expect(decide(null, approve).status).toBe("approved");
    expect(decide(null, approve).decidedBy).toBe("policy");
    expect(decide(null, deny).status).toBe("denied");
    expect(decide(null, deny).decidedByType).toBe("policy");
  });

  it("route_to_human stays pending with no decider", () => {
    const d = decide(null, human);
    expect(d.status).toBe("pending");
    expect(d.decidedBy).toBeNull();
    expect(d.decidedAt).toBeNull();
  });
});
