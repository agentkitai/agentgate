// @agentgate/cli - Types

/**
 * CLI configuration stored in ~/.agentgate/config.json
 */
export interface CliConfig {
  /** Server URL for the AgentGate server */
  serverUrl?: string;
  /** API key for authentication */
  apiKey?: string;
  /** Default timeout for requests in milliseconds */
  timeout?: number;
  /** Output format preference */
  outputFormat?: 'json' | 'table' | 'plain';
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Required<CliConfig> = {
  serverUrl: 'http://localhost:3000',
  apiKey: '',
  timeout: 30000,
  outputFormat: 'table',
};

/**
 * Request creation options
 */
export interface RequestOptions {
  action: string;
  params?: Record<string, unknown>;
  context?: Record<string, unknown>;
  urgency?: 'low' | 'normal' | 'high' | 'critical';
}

/**
 * List filter options
 */
export interface ListOptions {
  status?: 'pending' | 'approved' | 'denied' | 'expired';
  limit?: number;
  offset?: number;
}

/**
 * Decision options for approve/deny
 */
export interface DecisionOptions {
  requestId: string;
  reason?: string;
  decidedBy?: string;
}

/**
 * Paginated list response from server
 */
export interface PaginatedResponse<T> {
  requests: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}
