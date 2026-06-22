// @agentgate/server — MCP tool-call guardrails (issue #14).
//
// Enforce per-agent tool allow-listing at the MCP protocol boundary, right
// before a tool executes. Reuses the agent-identity spine (#12): the gate is
// keyed on the VERIFIED agent id, never a client-claimed one. A matching
// per-agent override (the existing dynamic-override mechanism) escalates the
// tool call to the human approval flow instead of letting it run.
//
// Precedence: this override gate runs FIRST, before the tool executes and
// before any approval request the tool itself would create. Static policy
// evaluation is intentionally NOT run here — matching checkOverrides' role in
// the approval path, where an override forces pending and bypasses policy.

import { nanoid } from "nanoid";
import {
  EventNames,
  createBaseEvent,
  getGlobalEmitter,
  type RequestCreatedEvent,
} from "@agentgate/core";

import { getDb, approvalRequests } from "../db/index.js";
import { checkOverrides } from "../routes/overrides.js";
import { owaspRiskForPolicyDecision } from "./owasp.js";
import { logAuditEvent } from "./audit.js";
import { getGlobalDispatcher } from "./notification/index.js";

export type McpAccessVerdict =
  | { decision: "allow" }
  | {
      decision: "requires_approval";
      status: "pending";
      requestId: string;
      reason: string | null;
      owaspRisk: string;
    };

/**
 * Decide whether an MCP tool call may execute for a verified agent.
 *
 * `verifiedAgentId` MUST be the cryptographically resolved id (see routes/mcp).
 * null means no agent identity was presented — overrides are per-agent, so
 * there is nothing to enforce and the call is allowed (fail-open). When a
 * per-agent override matches the tool, the call is escalated: a pending
 * approval request is created (reusing the normal flow) and the tool does NOT
 * run; the caller resolves it through the existing approve/deny path.
 */
export async function evaluateMcpToolAccess(opts: {
  verifiedAgentId: string | null;
  toolName: string;
  params?: Record<string, unknown>;
  context?: Record<string, unknown>;
}): Promise<McpAccessVerdict> {
  const { verifiedAgentId, toolName, params, context } = opts;
  if (!verifiedAgentId) return { decision: "allow" };

  const match = await checkOverrides(verifiedAgentId, toolName);
  if (!match) return { decision: "allow" };

  // Override matched → escalate to a pending approval request (Excessive Agency).
  const id = nanoid();
  const now = new Date();
  // route_to_human is the gating decision; owasp maps it to LLM06.
  const owaspRisk = owaspRiskForPolicyDecision("route_to_human")!;

  await getDb()
    .insert(approvalRequests)
    .values({
      id,
      action: toolName,
      params: JSON.stringify(params ?? {}),
      context: JSON.stringify({ ...(context ?? {}), source: "mcp" }),
      status: "pending",
      urgency: "normal",
      createdAt: now,
      updatedAt: now,
      decidedAt: null,
      decidedBy: null,
      decisionReason: `MCP tool gated by override: ${match.reason ?? "dynamic override"}`,
      expiresAt: null,
      verifiedAgentId,
    });

  await logAuditEvent(id, "created", "mcp", {
    toolName,
    params: params ?? {},
    context: context ?? {},
    overrideId: match.overrideId,
    decision: "requires_approval",
    owaspRisk,
    verifiedAgentId,
  });

  // Surface the pending request to humans the same way POST /api/requests does:
  // emit the created event and dispatch a notification. No policy channels here
  // (override-only gate) → the dispatcher falls back to configured/default routes.
  const createdEvent: RequestCreatedEvent = {
    ...createBaseEvent(EventNames.REQUEST_CREATED, "server"),
    payload: {
      requestId: id,
      action: toolName,
      params: params ?? {},
      context: { ...(context ?? {}), source: "mcp" },
      urgency: "normal",
    },
  };
  getGlobalEmitter().emitSync(createdEvent);
  getGlobalDispatcher().dispatchSync(createdEvent, undefined);

  return {
    decision: "requires_approval",
    status: "pending",
    requestId: id,
    reason: match.reason,
    owaspRisk,
  };
}
