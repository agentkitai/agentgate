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

// API types
export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
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
