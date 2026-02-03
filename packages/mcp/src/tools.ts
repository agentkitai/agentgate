/**
 * Tool handlers for AgentGate MCP server
 */
import type {
  RequestArgs,
  GetArgs,
  ListArgs,
  DecideArgs,
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
          enum: ['low', 'normal', 'high'],
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
      },
      required: ['id', 'decision'],
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
  });
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
          urgency: args.urgency as 'low' | 'normal' | 'high' | undefined,
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
        });
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return formatResult(result);
  } catch (error) {
    return formatError(error);
  }
}
