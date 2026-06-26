/**
 * Tool handlers for AgentGate MCP server
 */
import type {
  RequestArgs,
  GetArgs,
  ListArgs,
  DecideArgs,
  ListPoliciesArgs,
  CreatePolicyArgs,
  UpdatePolicyArgs,
  DeletePolicyArgs,
  ListAuditLogsArgs,
  GetAuditActorsArgs,
  ApiConfig,
  ToolResult,
} from './types.js';
import { apiCall } from './api.js';

/**
 * Tool definitions for MCP
 */
export const toolDefinitions = [
  {
    name: 'agentgate_request',
    description:
      'Submit an approval request. Returns request ID and initial status.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            'Action being requested (e.g., "send_email", "make_purchase")',
        },
        params: {
          type: 'object',
          description:
            'Action parameters (e.g., { to: "user@example.com", subject: "..." })',
        },
        context: {
          type: 'object',
          description: 'Additional context for the approver',
        },
        urgency: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'critical'],
          description: 'Request urgency',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'agentgate_get',
    description: 'Get the current status of an approval request by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Request ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'agentgate_list',
    description: 'List approval requests with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'approved', 'denied', 'expired'],
          description: 'Filter by status',
        },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
    },
  },
  {
    name: 'agentgate_decide',
    description:
      'Approve or deny a pending request. Use when you are the designated approver.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Request ID' },
        decision: {
          type: 'string',
          enum: ['approved', 'denied'],
          description: 'Your decision',
        },
        reason: { type: 'string', description: 'Reason for decision (optional)' },
        decidedBy: { type: 'string', description: 'Who is making this decision (default: "mcp:user")' },
      },
      required: ['id', 'decision'],
    },
  },
  {
    name: 'agentgate_list_policies',
    description: 'List all policies ordered by priority.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'agentgate_create_policy',
    description: 'Create a new policy with rules.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Policy name' },
        rules: {
          type: 'array',
          description: 'Array of policy rules with match conditions and decisions',
          items: { type: 'object' },
        },
        priority: { type: 'number', description: 'Policy priority (default 100)' },
        enabled: { type: 'boolean', description: 'Whether policy is enabled (default true)' },
      },
      required: ['name', 'rules'],
    },
  },
  {
    name: 'agentgate_update_policy',
    description: 'Replace an existing policy (all fields required).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Policy ID' },
        name: { type: 'string', description: 'Policy name' },
        rules: {
          type: 'array',
          description: 'Array of policy rules',
          items: { type: 'object' },
        },
        priority: { type: 'number', description: 'Policy priority' },
        enabled: { type: 'boolean', description: 'Whether policy is enabled' },
      },
      required: ['id', 'name', 'rules'],
    },
  },
  {
    name: 'agentgate_delete_policy',
    description: 'Delete a policy by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Policy ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'agentgate_list_audit_logs',
    description: 'List audit log entries with optional filters and pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Filter by action' },
        status: { type: 'string', enum: ['pending', 'approved', 'denied', 'expired'], description: 'Filter by status' },
        eventType: { type: 'string', enum: ['created', 'approved', 'denied', 'expired', 'viewed'], description: 'Filter by event type' },
        actor: { type: 'string', description: 'Filter by actor' },
        from: { type: 'string', description: 'Start date (ISO format)' },
        to: { type: 'string', description: 'End date (ISO format)' },
        requestId: { type: 'string', description: 'Filter by request ID' },
        limit: { type: 'number', description: 'Max results (default 50, max 100)' },
        offset: { type: 'number', description: 'Offset for pagination' },
      },
    },
  },
  {
    name: 'agentgate_get_audit_actors',
    description: 'Get unique actor values from audit logs.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
] as const;

/**
 * Build URL query string for list endpoint
 */
export function buildListParams(args: ListArgs): string {
  const params = new URLSearchParams();
  if (args.status) params.set('status', args.status);
  if (args.limit) params.set('limit', String(args.limit));
  return params.toString();
}

/**
 * Format success result
 */
export function formatResult(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Format error result
 */
export function formatError(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Map a guardrail verdict to a blocking tool result, or null when the call is
 * allowed (the caller then runs the tool). A `deny` is a synchronous error
 * result; `requires_approval` is a (non-error) pending result. Issue #14.
 */
export function guardrailBlockResult(
  verdict: { decision: string; requestId?: string; reason?: string | null } | null,
): ToolResult | null {
  if (verdict?.decision === 'deny') {
    return {
      ...formatResult({
        status: 'denied',
        reason: verdict.reason ?? null,
        message: 'Tool call denied by AgentGate policy.',
      }),
      isError: true,
    };
  }
  if (verdict?.decision === 'requires_approval') {
    return formatResult({
      status: 'pending',
      requestId: verdict.requestId,
      reason: verdict.reason ?? null,
      message: 'Tool call requires approval and was routed to AgentGate.',
    });
  }
  return null;
}

/**
 * Long-poll an approval request until it leaves `pending` or the budget runs out
 * (#42). Returns the terminal status (`approved`/`denied`/`expired`) or `pending`
 * on timeout. Transient read errors don't abort — they're retried until the
 * deadline (the caller treats a final `pending` as "still waiting").
 */
export async function waitForApproval(
  config: ApiConfig,
  requestId: string,
  opts: { waitMs: number; pollMs: number },
): Promise<string> {
  const deadline = Date.now() + opts.waitMs;
  for (;;) {
    let status: string | undefined;
    try {
      const res = (await apiCall(config, 'GET', `/api/requests/${requestId}`)) as { status?: string };
      status = res?.status;
    } catch {
      // transient — keep polling until the deadline
    }
    if (status && status !== 'pending') return status;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return 'pending';
    await new Promise((resolve) => setTimeout(resolve, Math.min(opts.pollMs, remaining)));
  }
}

/**
 * Authorize a tool call, optionally waiting inline for an approval decision
 * (#42), then run or block it. With `approvalWaitMs` unset/0 this is the legacy
 * flow (a `requires_approval` returns a pending handle immediately). With it >0,
 * a `requires_approval` long-polls: approved → run the tool; denied/expired →
 * error; still pending at timeout → the pending handle (unchanged shape).
 */
export async function executeGatedToolCall(
  config: ApiConfig,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const verdict = await authorizeTool(config, name, args);
  const waitMs = config.approvalWaitMs ?? 0;
  if (verdict?.decision === 'requires_approval' && verdict.requestId && waitMs > 0) {
    const status = await waitForApproval(config, verdict.requestId, {
      waitMs,
      pollMs: config.approvalPollMs ?? 2000,
    });
    if (status === 'approved') return handleToolCall(config, name, args);
    if (status === 'denied' || status === 'expired') {
      return {
        ...formatResult({ status, requestId: verdict.requestId, message: `Tool call ${status} by AgentGate.` }),
        isError: true,
      };
    }
    // still pending after the budget — fall through to the pending handle below.
  }
  const blocked = guardrailBlockResult(verdict);
  if (blocked) return blocked;
  return handleToolCall(config, name, args);
}

/**
 * Handle agentgate_request tool
 */
export async function handleRequest(
  config: ApiConfig,
  args: RequestArgs
): Promise<unknown> {
  return apiCall(config, 'POST', '/api/requests', {
    action: args.action,
    params: args.params,
    context: args.context,
    urgency: args.urgency,
  });
}

/**
 * Handle agentgate_get tool
 */
export async function handleGet(
  config: ApiConfig,
  args: GetArgs
): Promise<unknown> {
  return apiCall(config, 'GET', `/api/requests/${args.id}`);
}

/**
 * Handle agentgate_list tool
 */
export async function handleList(
  config: ApiConfig,
  args: ListArgs
): Promise<unknown> {
  const queryString = buildListParams(args);
  const path = queryString ? `/api/requests?${queryString}` : '/api/requests';
  return apiCall(config, 'GET', path);
}

/** Known decidedBy namespace prefixes */
const KNOWN_NAMESPACES = ['slack', 'discord', 'dashboard', 'mcp', 'policy', 'api', 'system'];

/**
 * Validate and normalize a decidedBy value to namespace:identifier format.
 * If already properly namespaced, returns as-is. Otherwise prefixes with `mcp:`.
 */
export function normalizeDecidedBy(value: string | undefined): string {
  if (!value) return 'mcp:user';

  // Check if it matches namespace:identifier format
  const colonIndex = value.indexOf(':');
  if (colonIndex > 0) {
    const prefix = value.slice(0, colonIndex);
    if (KNOWN_NAMESPACES.includes(prefix)) {
      return value;
    }
  }

  // Not properly namespaced — prefix with mcp:
  return `mcp:${value}`;
}

/**
 * Handle agentgate_decide tool
 */
export async function handleDecide(
  config: ApiConfig,
  args: DecideArgs
): Promise<unknown> {
  return apiCall(config, 'POST', `/api/requests/${args.id}/decide`, {
    decision: args.decision,
    reason: args.reason,
    decidedBy: normalizeDecidedBy(args.decidedBy),
  });
}

/**
 * Handle agentgate_list_policies tool
 */
export async function handleListPolicies(
  config: ApiConfig,
  _args: ListPoliciesArgs
): Promise<unknown> {
  return apiCall(config, 'GET', '/api/policies');
}

/**
 * Handle agentgate_create_policy tool
 */
export async function handleCreatePolicy(
  config: ApiConfig,
  args: CreatePolicyArgs
): Promise<unknown> {
  return apiCall(config, 'POST', '/api/policies', {
    name: args.name,
    rules: args.rules,
    priority: args.priority,
    enabled: args.enabled,
  });
}

/**
 * Handle agentgate_update_policy tool
 */
export async function handleUpdatePolicy(
  config: ApiConfig,
  args: UpdatePolicyArgs
): Promise<unknown> {
  return apiCall(config, 'PUT', `/api/policies/${args.id}`, {
    name: args.name,
    rules: args.rules,
    priority: args.priority,
    enabled: args.enabled,
  });
}

/**
 * Handle agentgate_delete_policy tool
 */
export async function handleDeletePolicy(
  config: ApiConfig,
  args: DeletePolicyArgs
): Promise<unknown> {
  return apiCall(config, 'DELETE', `/api/policies/${args.id}`);
}

/**
 * Build URL query string for audit list endpoint
 */
export function buildAuditParams(args: ListAuditLogsArgs): string {
  const params = new URLSearchParams();
  if (args.action) params.set('action', args.action);
  if (args.status) params.set('status', args.status);
  if (args.eventType) params.set('eventType', args.eventType);
  if (args.actor) params.set('actor', args.actor);
  if (args.from) params.set('from', args.from);
  if (args.to) params.set('to', args.to);
  if (args.requestId) params.set('requestId', args.requestId);
  if (args.limit) params.set('limit', String(args.limit));
  if (args.offset) params.set('offset', String(args.offset));
  return params.toString();
}

/**
 * Handle agentgate_list_audit_logs tool
 */
export async function handleListAuditLogs(
  config: ApiConfig,
  args: ListAuditLogsArgs
): Promise<unknown> {
  const queryString = buildAuditParams(args);
  const path = queryString ? `/api/audit?${queryString}` : '/api/audit';
  return apiCall(config, 'GET', path);
}

/**
 * Handle agentgate_get_audit_actors tool
 */
export async function handleGetAuditActors(
  config: ApiConfig,
  _args: GetAuditActorsArgs
): Promise<unknown> {
  return apiCall(config, 'GET', '/api/audit/actors');
}

/**
 * Ask the server whether a tool call is allowed for this MCP server's identity
 * (issue #14). The server keys the guardrail on the verified agent bound to the
 * api key. Returns the verdict (allow / requires_approval / deny), or null to
 * fail-open (allow) on a network/auth error.
 * ponytail: fail-open on error; add an AGENTGATE_GUARDRAIL_STRICT flag if a
 * deployment needs the gate to fail closed.
 */
export async function authorizeTool(
  config: ApiConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ decision: string; status?: string; requestId?: string; reason?: string | null } | null> {
  try {
    return (await apiCall(config, "POST", "/api/mcp/authorize", {
      toolName,
      params: args,
    })) as { decision: string; status?: string; requestId?: string; reason?: string | null };
  } catch (err) {
    console.error(`[guardrail] authorize failed for ${toolName}, allowing:`, err);
    return null;
  }
}

/**
 * Route tool call to appropriate handler
 */
export async function handleToolCall(
  config: ApiConfig,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    let result: unknown;

    switch (name) {
      case 'agentgate_request':
        result = await handleRequest(config, {
          action: args.action as string,
          params: args.params as Record<string, unknown> | undefined,
          context: args.context as Record<string, unknown> | undefined,
          urgency: args.urgency as 'low' | 'normal' | 'high' | 'critical' | undefined,
        });
        break;

      case 'agentgate_get':
        result = await handleGet(config, { id: args.id as string });
        break;

      case 'agentgate_list':
        result = await handleList(config, {
          status: args.status as 'pending' | 'approved' | 'denied' | 'expired' | undefined,
          limit: args.limit as number | undefined,
        });
        break;

      case 'agentgate_decide':
        result = await handleDecide(config, {
          id: args.id as string,
          decision: args.decision as 'approved' | 'denied',
          reason: args.reason as string | undefined,
          decidedBy: args.decidedBy as string | undefined,
        });
        break;

      case 'agentgate_list_policies':
        result = await handleListPolicies(config, {});
        break;

      case 'agentgate_create_policy':
        result = await handleCreatePolicy(config, {
          name: args.name as string,
          rules: args.rules as Array<Record<string, unknown>>,
          priority: args.priority as number | undefined,
          enabled: args.enabled as boolean | undefined,
        });
        break;

      case 'agentgate_update_policy':
        result = await handleUpdatePolicy(config, {
          id: args.id as string,
          name: args.name as string,
          rules: args.rules as Array<Record<string, unknown>>,
          priority: args.priority as number | undefined,
          enabled: args.enabled as boolean | undefined,
        });
        break;

      case 'agentgate_delete_policy':
        result = await handleDeletePolicy(config, { id: args.id as string });
        break;

      case 'agentgate_list_audit_logs':
        result = await handleListAuditLogs(config, {
          action: args.action as string | undefined,
          status: args.status as string | undefined,
          eventType: args.eventType as string | undefined,
          actor: args.actor as string | undefined,
          from: args.from as string | undefined,
          to: args.to as string | undefined,
          requestId: args.requestId as string | undefined,
          limit: args.limit as number | undefined,
          offset: args.offset as number | undefined,
        });
        break;

      case 'agentgate_get_audit_actors':
        result = await handleGetAuditActors(config, {});
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return formatResult(result);
  } catch (error) {
    return formatError(error);
  }
}
