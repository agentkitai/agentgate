// @agentgate/cli - API client

import type { ApprovalRequest, ApprovalStatus } from '@agentgate/core';
import { getResolvedConfig } from './config.js';
import type { RequestOptions, ListOptions, DecisionOptions, PaginatedResponse } from './types.js';

/**
 * API client for AgentGate server
 */
export class ApiClient {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;

  constructor() {
    const config = getResolvedConfig();
    this.baseUrl = config.serverUrl;
    this.apiKey = config.apiKey;
    this.timeout = config.timeout;
  }

  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorBody}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Create a new approval request
   */
  async createRequest(options: RequestOptions): Promise<ApprovalRequest> {
    return this.fetch<ApprovalRequest>('/api/requests', {
      method: 'POST',
      body: JSON.stringify({
        action: options.action,
        params: options.params ?? {},
        context: options.context ?? {},
        urgency: options.urgency ?? 'normal',
      }),
    });
  }

  /**
   * Get status of a specific request
   */
  async getRequest(requestId: string): Promise<ApprovalRequest> {
    return this.fetch<ApprovalRequest>(`/api/requests/${requestId}`);
  }

  /**
   * List approval requests
   */
  async listRequests(options: ListOptions = {}): Promise<{ requests: ApprovalRequest[]; pagination: PaginatedResponse<ApprovalRequest>['pagination'] }> {
    const params = new URLSearchParams();
    if (options.status) params.set('status', options.status);
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));

    const query = params.toString();
    const endpoint = query ? `/api/requests?${query}` : '/api/requests';
    return this.fetch<PaginatedResponse<ApprovalRequest>>(endpoint);
  }

  /**
   * Approve a request
   */
  async approveRequest(options: DecisionOptions): Promise<ApprovalRequest> {
    return this.fetch<ApprovalRequest>(`/api/requests/${options.requestId}/decide`, {
      method: 'POST',
      body: JSON.stringify({
        decision: 'approved',
        decidedBy: options.decidedBy ?? 'cli',
        reason: options.reason,
      }),
    });
  }

  /**
   * Deny a request
   */
  async denyRequest(options: DecisionOptions): Promise<ApprovalRequest> {
    return this.fetch<ApprovalRequest>(`/api/requests/${options.requestId}/decide`, {
      method: 'POST',
      body: JSON.stringify({
        decision: 'denied',
        decidedBy: options.decidedBy ?? 'cli',
        reason: options.reason,
      }),
    });
  }

  /**
   * Get server status
   */
  async getServerStatus(): Promise<{ status: string; timestamp: string }> {
    return this.fetch<{ status: string; timestamp: string }>('/health');
  }
}

/**
 * Format an approval request for display
 */
export function formatRequest(request: ApprovalRequest, format: 'json' | 'table' | 'plain'): string {
  if (format === 'json') {
    return JSON.stringify(request, null, 2);
  }

  if (format === 'plain') {
    return [
      `ID: ${request.id}`,
      `Action: ${request.action}`,
      `Status: ${request.status}`,
      `Urgency: ${request.urgency}`,
      `Created: ${request.createdAt}`,
      request.decidedAt ? `Decided: ${request.decidedAt}` : null,
      request.decidedBy ? `Decided by: ${request.decidedBy}` : null,
      request.decisionReason ? `Reason: ${request.decisionReason}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  // Table format (default)
  const statusIcon = getStatusIcon(request.status);
  return [
    `┌─────────────────────────────────────────────────────────┐`,
    `│ ${statusIcon} Request: ${request.id.padEnd(44)}│`,
    `├─────────────────────────────────────────────────────────┤`,
    `│ Action:   ${request.action.padEnd(46)}│`,
    `│ Status:   ${request.status.padEnd(46)}│`,
    `│ Urgency:  ${request.urgency.padEnd(46)}│`,
    `│ Created:  ${String(request.createdAt).padEnd(46)}│`,
    request.decidedAt ? `│ Decided:  ${String(request.decidedAt).padEnd(46)}│` : null,
    request.decidedBy ? `│ By:       ${request.decidedBy.padEnd(46)}│` : null,
    `└─────────────────────────────────────────────────────────┘`,
  ]
    .filter(Boolean)
    .join('\n');
}

function getStatusIcon(status: ApprovalStatus): string {
  switch (status) {
    case 'pending':
      return '⏳';
    case 'approved':
      return '✅';
    case 'denied':
      return '❌';
    case 'expired':
      return '⌛';
    default:
      return '❓';
  }
}

/**
 * Format a list of requests for display
 */
export function formatRequestList(
  requests: ApprovalRequest[],
  format: 'json' | 'table' | 'plain'
): string {
  if (format === 'json') {
    return JSON.stringify(requests, null, 2);
  }

  if (requests.length === 0) {
    return 'No requests found.';
  }

  if (format === 'plain') {
    return requests.map((r) => `${r.id}\t${r.status}\t${r.action}`).join('\n');
  }

  // Table format
  const header = [
    '┌────────────────────────────────────┬──────────┬────────────────────────────────┐',
    '│ ID                                 │ Status   │ Action                         │',
    '├────────────────────────────────────┼──────────┼────────────────────────────────┤',
  ].join('\n');

  const rows = requests
    .map((r) => {
      const id = r.id.substring(0, 34).padEnd(34);
      const status = `${getStatusIcon(r.status)} ${r.status}`.padEnd(8);
      const action = r.action.substring(0, 30).padEnd(30);
      return `│ ${id} │ ${status} │ ${action} │`;
    })
    .join('\n');

  const footer = '└────────────────────────────────────┴──────────┴────────────────────────────────┘';

  return `${header}\n${rows}\n${footer}`;
}
