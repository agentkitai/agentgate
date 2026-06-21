// @agentgate/server — OWASP LLM Top-10 (2025) risk tagging for the audit trail.
//
// Tagging each policy decision with the OWASP LLM risk it addresses turns the
// approval audit log into compliance evidence (filterable/exportable per risk).
// Gating or escalating an agent's tool action is fundamentally an Excessive
// Agency (LLM06) control; auto-approved actions were within policy bounds, so
// they carry no tag.

export const OWASP_LLM = {
  EXCESSIVE_AGENCY: "LLM06:2025 Excessive Agency",
  UNBOUNDED_CONSUMPTION: "LLM10:2025 Unbounded Consumption",
} as const;

/**
 * Map an approval-gateway policy decision to the OWASP LLM Top-10 risk it
 * mitigates. Returns undefined when no risk is flagged (e.g. auto-approve).
 */
export function owaspRiskForPolicyDecision(decision: string): string | undefined {
  switch (decision) {
    case "auto_deny":
    case "deny":
    case "route_to_human":
    case "ask":
      return OWASP_LLM.EXCESSIVE_AGENCY;
    default:
      return undefined;
  }
}
