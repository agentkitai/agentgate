/**
 * API client for AgentGate server
 */
import type { ApiConfig, ApiErrorResponse } from './types.js';

export async function apiCall(
  config: ApiConfig,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({
      error: response.statusText,
    }))) as ApiErrorResponse;
    throw new Error(errorBody.error ?? `API error: ${response.status}`);
  }

  return response.json();
}
