import { describe, it, expect } from "vitest";

import { OWASP_LLM, owaspRiskForPolicyDecision } from "../lib/owasp.js";

describe("owaspRiskForPolicyDecision", () => {
  it("tags gated / escalated decisions as Excessive Agency (LLM06)", () => {
    expect(owaspRiskForPolicyDecision("auto_deny")).toBe(OWASP_LLM.EXCESSIVE_AGENCY);
    expect(owaspRiskForPolicyDecision("deny")).toBe(OWASP_LLM.EXCESSIVE_AGENCY);
    expect(owaspRiskForPolicyDecision("route_to_human")).toBe(OWASP_LLM.EXCESSIVE_AGENCY);
    expect(owaspRiskForPolicyDecision("ask")).toBe(OWASP_LLM.EXCESSIVE_AGENCY);
  });

  it("does not tag auto-approved (within-policy) actions", () => {
    expect(owaspRiskForPolicyDecision("auto_approve")).toBeUndefined();
    expect(owaspRiskForPolicyDecision("unknown")).toBeUndefined();
  });
});
