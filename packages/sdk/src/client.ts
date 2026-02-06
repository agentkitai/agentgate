// @agentgate/sdk - AgentGate Client

import type { ApprovalRequest, ApprovalUrgency } from '@agentgate/core';
import { AgentGateError, TimeoutError } from './errors.js';

/**
 * Options for creating an AgentGate client
 */
export interface ClientOptions {
  /** Base URL of the AgentGate server */
  baseUrl: string;
  /** API key for authentication (optional) */
  apiKey?: string;
}

/**
 * Options for creating an approval request
 */
export interface RequestOptions {
  /** The action being requested (e.g., "send_email", "transfer_funds") */
  action: string;
  /** Parameters for the action */
  params?: Record<string, unknown>;
  /** Contextual information about the request */
  context?: Record<string, unknown>;
  /** Urgency level */
  urgency?: ApprovalUrgency;
  /** When the request should expire */
  expiresAt?: Date;
}

/**
 * Options for waiting for a decision
 */
export interface WaitOptions {
  /** Timeout in milliseconds (default: 5 minutes) */
  timeout?: number;
  /** Poll interval in milliseconds (default: 2 seconds) */
  pollInterval?: number;
}

/**
 * Options for listing requests
 */
export interface ListOptions {
  /** Filter by status */
  status?: string;
  /** Filter by action */
  action?: string;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * AgentGate client for agents to request approvals
 */
export class AgentGateClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(options: ClientOptions) {
    // Remove trailing slash from baseUrl
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
  }

  /**
   * Make an HTTP request to the AgentGate server
   */
  private async fetch<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let message = `Request failed with status ${response.status}`;
      let code: string | undefined;

      try {
        const errorBody = await response.json() as { message?: string; code?: string };
        if (errorBody.message) {
          message = errorBody.message;
        }
        code = errorBody.code;
      } catch {
        // Ignore JSON parse errors
      }

      throw new AgentGateError(message, response.status, code);
    }

    // Handle empty responses (204 No Content, etc.)
    const contentType = response.headers.get('Content-Type');
    if (response.status === 204 || !contentType?.includes('application/json')) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  /**
   * Convert API response to ApprovalRequest with proper Date objects
   */
  private parseRequest(data: Record<string, unknown>): ApprovalRequest {
    return {
      ...data,
      createdAt: new Date(data.createdAt as string),
      updatedAt: new Date(data.updatedAt as string),
      decidedAt: data.decidedAt ? new Date(data.decidedAt as string) : undefined,
      expiresAt: data.expiresAt ? new Date(data.expiresAt as string) : undefined,
    } as ApprovalRequest;
  }

  /**
   * Submit an approval request
   * Returns immediately with the created request
   */
  async request(opts: RequestOptions): Promise<ApprovalRequest> {
    const body = {
      action: opts.action,
      params: opts.params ?? {},
      context: opts.context ?? {},
      urgency: opts.urgency ?? 'normal',
      expiresAt: opts.expiresAt?.toISOString(),
    };

    const data = await this.fetch<Record<string, unknown>>('/api/requests', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return this.parseRequest(data);
  }

  /**
   * Get an approval request by ID
   */
  async getRequest(id: string): Promise<ApprovalRequest> {
    const data = await this.fetch<Record<string, unknown>>(`/api/requests/${id}`);
    return this.parseRequest(data);
  }

  /**
   * Poll until a decision is made or timeout
   * @param id - Request ID to watch
   * @param opts - Timeout and poll interval options
   * @returns The request with a decision (approved, denied, or expired)
   * @throws TimeoutError if timeout is reached before a decision
   */
  async waitForDecision(
    id: string,
    opts: WaitOptions = {}
  ): Promise<ApprovalRequest> {
    const timeout = opts.timeout ?? 5 * 60 * 1000; // 5 minutes default
    const pollInterval = opts.pollInterval ?? 2000; // 2 seconds default

    const startTime = Date.now();

    while (true) {
      const request = await this.getRequest(id);

      // Check if decision has been made
      if (request.status !== 'pending') {
        return request;
      }

      // Check timeout
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeout) {
        throw new TimeoutError(
          `Timed out waiting for decision on request ${id} after ${timeout}ms`
        );
      }

      // Wait before next poll
      await this.sleep(pollInterval);
    }
  }

  // confirm() was removed in v0.5 — the /api/requests/:id/confirm endpoint
  // was never implemented. Use the audit log endpoint for action tracking.

  /**
   * List approval requests with optional filters
   */
  async listRequests(opts: ListOptions = {}): Promise<ApprovalRequest[]> {
    const params = new URLSearchParams();
    
    if (opts.status) params.set('status', opts.status);
    if (opts.action) params.set('action', opts.action);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.offset !== undefined) params.set('offset', String(opts.offset));

    const query = params.toString();
    const path = query ? `/api/requests?${query}` : '/api/requests';

    const data = await this.fetch<{ requests: Record<string, unknown>[]; pagination: unknown }>(path);
    return data.requests.map((item) => this.parseRequest(item));
  }

  /**
   * Sleep helper for polling
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
