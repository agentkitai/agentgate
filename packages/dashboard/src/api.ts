// API client for AgentGate server

const baseUrl = import.meta.env.VITE_API_BASE_URL || '';
const STORAGE_KEY = 'agentgate_api_key';

export interface ApprovalRequest {
  id: string;
  action: string;
  params: Record<string, unknown>;
  context: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  urgency: 'low' | 'normal' | 'high' | 'critical';
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

export interface ListRequestsResponse {
  requests: ApprovalRequest[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
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

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

export const api = {
  // List requests with optional filters
  async listRequests(params?: {
    status?: string;
    action?: string;
    limit?: number;
    offset?: number;
  }): Promise<ListRequestsResponse> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.action) searchParams.set('action', params.action);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    const url = `${baseUrl}/api/requests${query ? `?${query}` : ''}`;
    
    const response = await fetch(url, { headers: getHeaders() });
    return handleResponse<ListRequestsResponse>(response);
  },

  // Get single request by ID
  async getRequest(id: string): Promise<ApprovalRequest> {
    const response = await fetch(`${baseUrl}/api/requests/${id}`, {
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
    const response = await fetch(`${baseUrl}/api/requests/${id}/decide`, {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify({ decision, decidedBy, reason }),
    });
    return handleResponse<ApprovalRequest>(response);
  },

  // Get audit trail for a request
  async getAuditLog(id: string): Promise<AuditLogEntry[]> {
    const response = await fetch(`${baseUrl}/api/requests/${id}/audit`, {
      headers: getHeaders(),
    });
    return handleResponse<AuditLogEntry[]>(response);
  },

  // Validate API key by making a test request
  async validateKey(): Promise<boolean> {
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: getHeaders(),
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

    const response = await fetch(url, { headers: getHeaders() });
    return handleResponse<ListAuditResponse>(response);
  },

  // Get unique actions for filter dropdown
  async getAuditActions(): Promise<{ actions: string[] }> {
    const response = await fetch(`${baseUrl}/api/audit/actions`, {
      headers: getHeaders(),
    });
    return handleResponse<{ actions: string[] }>(response);
  },

  // Get unique actors for filter dropdown
  async getAuditActors(): Promise<{ actors: string[] }> {
    const response = await fetch(`${baseUrl}/api/audit/actors`, {
      headers: getHeaders(),
    });
    return handleResponse<{ actors: string[] }>(response);
  },
};

// API for admin endpoints (API Keys, Webhooks)
export const adminApi = {
  // API Keys
  async listApiKeys() {
    const response = await fetch(`${baseUrl}/api/api-keys`, {
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
    const response = await fetch(`${baseUrl}/api/api-keys`, {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify(data),
    });
    return handleResponse<{ id: string; key: string; name: string }>(response);
  },

  async updateApiKey(id: string, data: { name?: string; scopes?: string[]; rateLimit?: number | null }) {
    const response = await fetch(`${baseUrl}/api/api-keys/${id}`, {
      method: 'PATCH',
      headers: getHeaders('application/json'),
      body: JSON.stringify(data),
    });
    return handleResponse<{ success: boolean }>(response);
  },

  async deleteApiKey(id: string) {
    const response = await fetch(`${baseUrl}/api/api-keys/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<{ success: boolean }>(response);
  },

  // Webhooks
  async listWebhooks() {
    const response = await fetch(`${baseUrl}/api/webhooks`, {
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
    const response = await fetch(`${baseUrl}/api/webhooks/${id}`, {
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
    const response = await fetch(`${baseUrl}/api/webhooks`, {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify(data),
    });
    return handleResponse<{ id: string; secret: string }>(response);
  },

  async updateWebhook(id: string, data: { enabled?: boolean }) {
    const response = await fetch(`${baseUrl}/api/webhooks/${id}`, {
      method: 'PATCH',
      headers: getHeaders('application/json'),
      body: JSON.stringify(data),
    });
    return handleResponse<{ success: boolean }>(response);
  },

  async deleteWebhook(id: string) {
    const response = await fetch(`${baseUrl}/api/webhooks/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<{ success: boolean }>(response);
  },

  async testWebhook(id: string) {
    const response = await fetch(`${baseUrl}/api/webhooks/${id}/test`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse<{ success: boolean; message?: string }>(response);
  },
};
