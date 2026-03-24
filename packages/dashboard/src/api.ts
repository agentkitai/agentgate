// API client for AgentGate server

import type { ApprovalStatus, ApprovalUrgency } from '@agentgate/core';

export type { ApprovalStatus, ApprovalUrgency };

const baseUrl = import.meta.env.VITE_API_BASE_URL || '';
const STORAGE_KEY = 'agentgate_api_key';
const REFRESH_TOKEN_KEY = 'agentgate_refresh_token';

/**
 * Serialized version of ApprovalRequest (JSON dates are strings, nulls instead of undefined).
 * Core's ApprovalRequest uses Date objects; this interface represents the JSON-serialized form.
 */
export interface ApprovalRequest {
  id: string;
  action: string;
  params: Record<string, unknown>;
  context: Record<string, unknown>;
  status: ApprovalStatus;
  urgency: ApprovalUrgency;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionReason: string | null;
  expiresAt: string | null;
}

export interface AuditLogEntry {
  id: string;
  requestId: string;
  eventType: string;
  actor: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditEntryWithRequest extends AuditLogEntry {
  request: {
    id: string;
    action: string;
    status: string;
    urgency: string;
  } | null;
}

export interface ListAuditResponse {
  entries: AuditEntryWithRequest[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface PolicyTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  rules: Array<{ match: Record<string, unknown>; decision: string }>;
  decision: string;
  priority: number;
}

export interface ListPoliciesResponse {
  policies: Array<{
    id: string;
    name: string;
    rules: Array<{ match: Record<string, unknown>; decision: string }>;
    priority: number;
    enabled: boolean;
    createdAt: string;
  }>;
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface ApprovalRequestWithSla extends ApprovalRequest {
  slaRemainingMs: number | null;
}

export interface ListRequestsResponse {
  requests: ApprovalRequestWithSla[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface QueueStatsResponse {
  total_pending: number;
  by_urgency: {
    critical: number;
    high: number;
    normal: number;
    low: number;
  };
  oldest_pending_age_ms: number | null;
}

/**
 * Get current API key from localStorage
 */
function getApiKey(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

/**
 * Build headers with Authorization if API key is set
 */
function getHeaders(contentType?: string): HeadersInit {
  const headers: HeadersInit = {};
  
  const apiKey = getApiKey();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  
  return headers;
}

// ── 401 Interceptor with Token Refresh ─────────────────────────────

let refreshPromise: Promise<boolean> | null = null;

/**
 * Attempt to refresh the session using the stored refresh token.
 * Returns true if refresh succeeded, false otherwise.
 */
async function tryRefreshToken(): Promise<boolean> {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      return false;
    }

    const data = await res.json();
    if (data.refreshToken) {
      localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch wrapper that automatically retries on 401 after attempting token refresh.
 * Includes credentials for cookie-based SSO sessions.
 */
async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const opts: RequestInit = {
    ...init,
    credentials: 'include',
  };

  const response = await fetch(url, opts);

  if (response.status === 401) {
    // Deduplicate concurrent refresh attempts
    if (!refreshPromise) {
      refreshPromise = tryRefreshToken().finally(() => {
        refreshPromise = null;
      });
    }

    const refreshed = await refreshPromise;
    if (refreshed) {
      // Retry the original request with updated cookie/headers
      return fetch(url, { ...opts, headers: getHeaders(undefined) });
    }

    // Refresh failed — redirect to login
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }

  return response;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

// SSO / Auth info types
export interface AuthProvidersResponse {
  authMode: string;
  ssoEnforced: boolean;
  oidcConfigured: boolean;
  oidcIssuer: string | null;
}

export interface AuthSessionResponse {
  identity: {
    type: 'user' | 'api_key';
    id: string;
    displayName: string;
    email?: string;
    role: string;
  };
  tenantId: string;
  permissions: string[];
  maxSessionDurationSec: number;
  sessionExpiresAt: number;
}

// Auth info API (public + authenticated endpoints)
export const authApi = {
  async getProviders(): Promise<AuthProvidersResponse> {
    const response = await fetch(`${baseUrl}/auth/providers`, {
      credentials: 'include',
    });
    return handleResponse<AuthProvidersResponse>(response);
  },

  async getSession(): Promise<AuthSessionResponse> {
    const response = await authFetch(`${baseUrl}/auth/session`, {
      headers: getHeaders(),
    });
    return handleResponse<AuthSessionResponse>(response);
  },
};

export const api = {
  // List policies with pagination
  async listPolicies(params?: {
    limit?: number;
    offset?: number;
  }): Promise<ListPoliciesResponse> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    const url = `${baseUrl}/api/policies${query ? `?${query}` : ''}`;

    const response = await authFetch(url, { headers: getHeaders() });
    return handleResponse<ListPoliciesResponse>(response);
  },

  // List policy templates
  async listPolicyTemplates(): Promise<{ templates: PolicyTemplate[] }> {
    const response = await authFetch(`${baseUrl}/api/policies/templates`, {
      headers: getHeaders(),
    });
    return handleResponse<{ templates: PolicyTemplate[] }>(response);
  },

  // Create a policy from a template
  async createPolicyFromTemplate(
    templateId: string,
    overrides?: { name?: string; priority?: number; enabled?: boolean }
  ): Promise<ListPoliciesResponse['policies'][number] & { templateId: string }> {
    const response = await authFetch(`${baseUrl}/api/policies/from-template`, {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify({ templateId, overrides }),
    });
    return handleResponse(response);
  },

  // List requests with optional filters
  async listRequests(params?: {
    status?: string;
    action?: string;
    sort?: string;
    limit?: number;
    offset?: number;
  }): Promise<ListRequestsResponse> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.action) searchParams.set('action', params.action);
    if (params?.sort) searchParams.set('sort', params.sort);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    const url = `${baseUrl}/api/requests${query ? `?${query}` : ''}`;

    const response = await authFetch(url, { headers: getHeaders() });
    return handleResponse<ListRequestsResponse>(response);
  },

  // Get queue stats for pending requests
  async getQueueStats(): Promise<QueueStatsResponse> {
    const response = await authFetch(`${baseUrl}/api/requests/queue-stats`, {
      headers: getHeaders(),
    });
    return handleResponse<QueueStatsResponse>(response);
  },

  // Get single request by ID
  async getRequest(id: string): Promise<ApprovalRequest> {
    const response = await authFetch(`${baseUrl}/api/requests/${id}`, {
      headers: getHeaders(),
    });
    return handleResponse<ApprovalRequest>(response);
  },

  // Submit decision (approve or deny)
  async decide(
    id: string,
    decision: 'approved' | 'denied',
    decidedBy: string,
    reason?: string
  ): Promise<ApprovalRequest> {
    const response = await authFetch(`${baseUrl}/api/requests/${id}/decide`, {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify({ decision, decidedBy, reason }),
    });
    return handleResponse<ApprovalRequest>(response);
  },

  // Get audit trail for a request
  async getAuditLog(id: string): Promise<AuditLogEntry[]> {
    const response = await authFetch(`${baseUrl}/api/requests/${id}/audit`, {
      headers: getHeaders(),
    });
    return handleResponse<AuditLogEntry[]>(response);
  },

  // Validate API key by making a test request
  async validateKey(): Promise<boolean> {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: getHeaders(),
        credentials: 'include',
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  // List audit entries with filters and pagination
  async listAuditEntries(params?: {
    action?: string;
    status?: string;
    eventType?: string;
    actor?: string;
    from?: string;
    to?: string;
    requestId?: string;
    limit?: number;
    offset?: number;
  }): Promise<ListAuditResponse> {
    const searchParams = new URLSearchParams();
    if (params?.action) searchParams.set('action', params.action);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.eventType) searchParams.set('eventType', params.eventType);
    if (params?.actor) searchParams.set('actor', params.actor);
    if (params?.from) searchParams.set('from', params.from);
    if (params?.to) searchParams.set('to', params.to);
    if (params?.requestId) searchParams.set('requestId', params.requestId);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    const url = `${baseUrl}/api/audit${query ? `?${query}` : ''}`;

    const response = await authFetch(url, { headers: getHeaders() });
    return handleResponse<ListAuditResponse>(response);
  },

  // Get unique actions for filter dropdown
  async getAuditActions(): Promise<{ actions: string[] }> {
    const response = await authFetch(`${baseUrl}/api/audit/actions`, {
      headers: getHeaders(),
    });
    return handleResponse<{ actions: string[] }>(response);
  },

  // Get unique actors for filter dropdown
  async getAuditActors(): Promise<{ actors: string[] }> {
    const response = await authFetch(`${baseUrl}/api/audit/actors`, {
      headers: getHeaders(),
    });
    return handleResponse<{ actors: string[] }>(response);
  },
};

// Analytics types
export interface AnalyticsOverview {
  totalRequests: number;
  approved: number;
  denied: number;
  expired: number;
  pending: number;
  approvalRate: number;
  avgDecisionTimeMs: number;
  autoApproveRate: number;
}

export interface TrendBucket {
  bucket: string;
  requests: number;
  approved: number;
  denied: number;
  expired: number;
  avgDecisionTimeMs: number;
}

export interface PolicyStat {
  policyId: string;
  policyName: string;
  hitCount: number;
  autoApproveCount: number;
  autoDenyCount: number;
  routeToHumanCount: number;
}

export const analyticsApi = {
  async getOverview(params?: { from?: string; to?: string }): Promise<AnalyticsOverview> {
    const searchParams = new URLSearchParams();
    if (params?.from) searchParams.set('from', params.from);
    if (params?.to) searchParams.set('to', params.to);
    const query = searchParams.toString();
    const url = `${baseUrl}/api/analytics/overview${query ? `?${query}` : ''}`;
    const response = await authFetch(url, { headers: getHeaders() });
    return handleResponse<AnalyticsOverview>(response);
  },

  async getTrends(params?: { from?: string; to?: string; bucket?: string }): Promise<{ trends: TrendBucket[] }> {
    const searchParams = new URLSearchParams();
    if (params?.from) searchParams.set('from', params.from);
    if (params?.to) searchParams.set('to', params.to);
    if (params?.bucket) searchParams.set('bucket', params.bucket);
    const query = searchParams.toString();
    const url = `${baseUrl}/api/analytics/trends${query ? `?${query}` : ''}`;
    const response = await authFetch(url, { headers: getHeaders() });
    return handleResponse<{ trends: TrendBucket[] }>(response);
  },

  async getPolicies(): Promise<{ policies: PolicyStat[] }> {
    const response = await authFetch(`${baseUrl}/api/analytics/policies`, {
      headers: getHeaders(),
    });
    return handleResponse<{ policies: PolicyStat[] }>(response);
  },
};

// Simulation API types
export interface SimulateRequest {
  rules: Array<{ match: Record<string, unknown>; decision: string }>;
  priority?: number;
  from?: string;
  to?: string;
  limit?: number;
}

export interface SimulateResponse {
  total: number;
  results: {
    autoApproved: number;
    autoDenied: number;
    routedToHuman: number;
  };
  changed: number;
  details: Array<{
    requestId: string;
    action: string;
    candidateDecision: string;
    currentDecision: string;
    changed: boolean;
  }>;
}

export interface DryRunRequest {
  action: string;
  params?: Record<string, unknown>;
  context?: Record<string, unknown>;
  urgency?: string;
}

export interface DryRunResponse {
  decision: string;
  matchedRule: Record<string, unknown> | null;
  reason: string;
}

// Simulation API
export const simulationApi = {
  async simulate(data: SimulateRequest): Promise<SimulateResponse> {
    const response = await authFetch(`${baseUrl}/api/policies/simulate`, {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify(data),
    });
    return handleResponse<SimulateResponse>(response);
  },

  async dryRun(policyId: string, data: DryRunRequest): Promise<DryRunResponse> {
    const response = await authFetch(`${baseUrl}/api/policies/${policyId}/dry-run`, {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify(data),
    });
    return handleResponse<DryRunResponse>(response);
  },
};

// Webhook Observability types
export interface WebhookDeliveryRecord {
  id: string;
  webhookId: string;
  event: string;
  payload: string;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  lastAttemptAt: number | null;
  responseCode: number | null;
  responseBody: string | null;
}

export interface WebhookStatsPerWebhook {
  webhookId: string;
  url: string;
  successRate: number;
  avgLatencyMs: number;
  pendingRetries: number;
  lastDeliveryAt: number | null;
}

export interface WebhookStatsResponse {
  totalDeliveries: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgResponseTimeMs: number;
  pendingRetryCount: number;
  perWebhook: WebhookStatsPerWebhook[];
}

export interface WebhookDeliveriesResponse {
  deliveries: WebhookDeliveryRecord[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

// API for admin endpoints (API Keys, Webhooks)
export const adminApi = {
  // API Keys
  async listApiKeys() {
    const response = await authFetch(`${baseUrl}/api/api-keys`, {
      headers: getHeaders(),
    });
    return handleResponse<{ keys: Array<{
      id: string;
      name: string;
      scopes: string[];
      createdAt: number;
      lastUsedAt: number | null;
      rateLimit: number | null;
      active: boolean;
    }> }>(response);
  },

  async createApiKey(data: { name: string; scopes: string[]; rateLimit: number | null }) {
    const response = await authFetch(`${baseUrl}/api/api-keys`, {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify(data),
    });
    return handleResponse<{ id: string; key: string; name: string }>(response);
  },

  async updateApiKey(id: string, data: { name?: string; scopes?: string[]; rateLimit?: number | null }) {
    const response = await authFetch(`${baseUrl}/api/api-keys/${id}`, {
      method: 'PATCH',
      headers: getHeaders('application/json'),
      body: JSON.stringify(data),
    });
    return handleResponse<{ success: boolean }>(response);
  },

  async deleteApiKey(id: string) {
    const response = await authFetch(`${baseUrl}/api/api-keys/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<{ success: boolean }>(response);
  },

  // Webhooks
  async listWebhooks() {
    const response = await authFetch(`${baseUrl}/api/webhooks`, {
      headers: getHeaders(),
    });
    return handleResponse<{ webhooks: Array<{
      id: string;
      url: string;
      events: string[];
      created_at: number;
      enabled: boolean;
    }> }>(response);
  },

  async getWebhook(id: string) {
    const response = await authFetch(`${baseUrl}/api/webhooks/${id}`, {
      headers: getHeaders(),
    });
    return handleResponse<{
      id: string;
      url: string;
      events: string[];
      created_at: number;
      enabled: boolean;
      deliveries?: Array<{
        id: string;
        event: string;
        status: string;
        attempts: number;
        last_attempt_at: number | null;
        response_code: number | null;
      }>;
    }>(response);
  },

  async createWebhook(data: { url: string; events: string[] }) {
    const response = await authFetch(`${baseUrl}/api/webhooks`, {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify(data),
    });
    return handleResponse<{ id: string; secret: string }>(response);
  },

  async updateWebhook(id: string, data: { enabled?: boolean }) {
    const response = await authFetch(`${baseUrl}/api/webhooks/${id}`, {
      method: 'PATCH',
      headers: getHeaders('application/json'),
      body: JSON.stringify(data),
    });
    return handleResponse<{ success: boolean }>(response);
  },

  async deleteWebhook(id: string) {
    const response = await authFetch(`${baseUrl}/api/webhooks/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<{ success: boolean }>(response);
  },

  async testWebhook(id: string) {
    const response = await authFetch(`${baseUrl}/api/webhooks/${id}/test`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse<{ success: boolean; message?: string }>(response);
  },

  // Webhook Observability
  async getWebhookStats() {
    const response = await authFetch(`${baseUrl}/api/webhooks/stats`, {
      headers: getHeaders(),
    });
    return handleResponse<WebhookStatsResponse>(response);
  },

  async getWebhookDeliveries(webhookId: string, params?: {
    limit?: number;
    offset?: number;
    status?: string;
  }) {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());
    if (params?.status) searchParams.set('status', params.status);

    const query = searchParams.toString();
    const url = `${baseUrl}/api/webhooks/${webhookId}/deliveries${query ? `?${query}` : ''}`;

    const response = await authFetch(url, { headers: getHeaders() });
    return handleResponse<WebhookDeliveriesResponse>(response);
  },

  async replayDelivery(deliveryId: string) {
    const response = await authFetch(`${baseUrl}/api/webhooks/deliveries/${deliveryId}/replay`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse<{ success: boolean; delivery: WebhookDeliveryRecord }>(response);
  },
};
