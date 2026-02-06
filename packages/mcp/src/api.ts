/**
 * API client for AgentGate server
 *
 * Thin wrapper around the shared AgentGateHttpClient from @agentgate/core.
 */
import { AgentGateHttpClient } from '@agentgate/core';
import type { ApiConfig } from './types.js';

/**
 * Create an AgentGateHttpClient from the MCP ApiConfig.
 */
export function createClient(config: ApiConfig): AgentGateHttpClient {
  return new AgentGateHttpClient(config.baseUrl, config.apiKey);
}

/**
 * Legacy-compatible helper — delegates to the shared HTTP client.
 */
export async function apiCall(
  config: ApiConfig,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  const client = createClient(config);
  return client.request(method, path, body);
}
