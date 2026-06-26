/**
 * decideInitialStatus — the budget > override > policy precedence (#13).
 * This is the real decision logic the requests route runs.
 */
import { describe, it, expect } from "vitest";
import type { PolicyDecision } from "@agentkitai/agentgate-core";
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

  it("a deny override hard-denies, beating a route_to_human policy (#14)", () => {
    const d = decideInitialStatus({
      budgetReason: null,
      overrideMatch: { action: "deny", reason: "tool blocked" },
      policyDecision: human,
      now: NOW,
    });
    expect(d.status).toBe("denied");
    expect(d.decidedBy).toBe("override");
    expect(d.decidedByType).toBe("override"); // not "policy" — overrides are their own source
    expect(d.decidedAt).toBe(NOW);
    expect(d.decisionReason).toContain("Denied by override");
  });

  it("budget deny still outranks a deny override (#14)", () => {
    const d = decideInitialStatus({
      budgetReason: "over budget",
      overrideMatch: { action: "deny", reason: "x" },
      policyDecision: human,
      now: NOW,
    });
    expect(d.status).toBe("denied");
    expect(d.decidedByType).toBe("budget_limiter"); // budget precedence preserved
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

  // ── Eval gate (#7) ──────────────────────────────────────
  it("eval gate denies, beating override + policy", () => {
    const d = decideInitialStatus({
      budgetReason: null,
      evalReason: "Eval gate: pass-rate 0.50 below required 0.80",
      overrideMatch: override,
      policyDecision: approve,
      now: NOW,
    });
    expect(d.status).toBe("denied");
    expect(d.decidedBy).toBe("eval_gate");
    expect(d.decidedByType).toBe("eval_gate");
    expect(d.decisionReason).toContain("Eval gate");
  });

  it("budget deny outranks the eval gate (budget precedence preserved)", () => {
    const d = decideInitialStatus({
      budgetReason: "over budget",
      evalReason: "Eval gate: below threshold",
      overrideMatch: null,
      policyDecision: approve,
      now: NOW,
    });
    expect(d.decidedByType).toBe("budget_limiter");
  });

  it("no evalReason → unchanged behavior (gate off / agent passes)", () => {
    expect(decide(null, approve).status).toBe("approved"); // evalReason omitted entirely
  });
});
