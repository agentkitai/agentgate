/**
 * Types for AgentGate MCP server
 */

// Request types
export interface RequestArgs {
  action: string;
  params?: Record<string, unknown>;
  context?: Record<string, unknown>;
  urgency?: 'low' | 'normal' | 'high' | 'critical';
}

export interface GetArgs {
  id: string;
}

export interface ListArgs {
  status?: 'pending' | 'approved' | 'denied' | 'expired';
  limit?: number;
}

export interface DecideArgs {
  id: string;
  decision: 'approved' | 'denied';
  reason?: string;
  decidedBy?: string;
}

// Policy types
export interface ListPoliciesArgs {
  // no required args
}

export interface CreatePolicyArgs {
  name: string;
  rules: Array<Record<string, unknown>>;
  priority?: number;
  enabled?: boolean;
}

export interface UpdatePolicyArgs {
  id: string;
  name: string;
  rules: Array<Record<string, unknown>>;
  priority?: number;
  enabled?: boolean;
}

export interface DeletePolicyArgs {
  id: string;
}

// Audit types
export interface ListAuditLogsArgs {
  action?: string;
  status?: string;
  eventType?: string;
  actor?: string;
  from?: string;
  to?: string;
  requestId?: string;
  limit?: number;
  offset?: number;
}

export interface GetAuditActorsArgs {
  // no required args
}

// API types
export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  /** Inline-approval long-poll budget (ms). 0 (default) returns a pending handle
   *  immediately (legacy). >0 waits inline for the decision (#42). */
  approvalWaitMs?: number;
  /** Poll interval (ms) while waiting for an approval decision. */
  approvalPollMs?: number;
  /** When the guardrail authorize call errors, allow the tool through instead of
   *  blocking it. Default false (fail closed). Set via AGENTGATE_GUARDRAIL_FAIL_OPEN. */
  guardrailFailOpen?: boolean;
}

export interface ApiErrorResponse {
  error?: string;
}

// Tool result types (must match MCP SDK's CallToolResult)
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}
