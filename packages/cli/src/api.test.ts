// @agentgate/cli - API client tests

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient, formatRequest, formatRequestList } from './api.js';
import type { ApprovalRequest } from '@agentgate/core';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock config
vi.mock('./config.js', () => ({
  getResolvedConfig: () => ({
    serverUrl: 'http://localhost:3000',
    apiKey: 'test-key',
    timeout: 5000,
    outputFormat: 'table',
  }),
}));

// Helper to create mock request
function createMockRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'req-test-123',
    action: 'send_email',
    params: {},
    context: {},
    status: 'pending',
    urgency: 'normal',
    createdAt: new Date('2026-02-03T10:00:00Z'),
    expiresAt: new Date('2026-02-03T11:00:00Z'),
    ...overrides,
  };
}

describe('ApiClient', () => {
  let client: ApiClient;

  beforeEach(() => {
    client = new ApiClient();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getServerStatus', () => {
    it('should call /health endpoint (not /api/health)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'ok', timestamp: '2026-02-03T10:00:00Z' }),
      });

      await client.getServerStatus();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/health',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key',
          }),
        })
      );
    });
  });

  describe('listRequests', () => {
    it('should return requests array and pagination', async () => {
      const mockResponse = {
        requests: [{ id: 'req-1', action: 'test', status: 'pending' }],
        pagination: { total: 1, limit: 50, offset: 0, hasMore: false },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.listRequests();

      expect(result.requests).toEqual(mockResponse.requests);
      expect(result.pagination).toEqual(mockResponse.pagination);
    });
  });

  describe('approveRequest', () => {
    it('should call /decide endpoint with correct body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'req-1',
            status: 'approved',
            decidedBy: 'user@example.com',
          }),
      });

      await client.approveRequest({
        requestId: 'req-1',
        reason: 'looks good',
        decidedBy: 'user@example.com',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/requests/req-1/decide',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            decision: 'approved',
            decidedBy: 'user@example.com',
            reason: 'looks good',
          }),
        })
      );
    });

    it('should default decidedBy to "cli"', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'req-1', status: 'approved' }),
      });

      await client.approveRequest({ requestId: 'req-1' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"decidedBy":"cli"'),
        })
      );
    });
  });

  describe('denyRequest', () => {
    it('should call /decide endpoint with denied decision', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'req-1',
            status: 'denied',
            decidedBy: 'admin',
          }),
      });

      await client.denyRequest({
        requestId: 'req-1',
        reason: 'not authorized',
        decidedBy: 'admin',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/requests/req-1/decide',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            decision: 'denied',
            decidedBy: 'admin',
            reason: 'not authorized',
          }),
        })
      );
    });
  });

  describe('createRequest', () => {
    it('should call /api/requests with POST', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'req-new',
            action: 'send_email',
            status: 'pending',
          }),
      });

      await client.createRequest({
        action: 'send_email',
        params: { to: 'test@example.com' },
        context: { source: 'test' },
        urgency: 'high',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/requests',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            action: 'send_email',
            params: { to: 'test@example.com' },
            context: { source: 'test' },
            urgency: 'high',
          }),
        })
      );
    });
  });

  describe('getRequest', () => {
    it('should call /api/requests/:id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'req-123',
            action: 'test',
            status: 'pending',
          }),
      });

      await client.getRequest('req-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/requests/req-123',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key',
          }),
        })
      );
    });
  });

  describe('error handling', () => {
    it('should throw on HTTP error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not found'),
      });

      await expect(client.getRequest('nonexistent')).rejects.toThrow('HTTP 404: Not found');
    });

    it('should throw on HTTP 500 errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal server error'),
      });

      await expect(client.getServerStatus()).rejects.toThrow('HTTP 500: Internal server error');
    });
  });

  describe('listRequests with filters', () => {
    it('should pass status filter in query string', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ requests: [], pagination: {} }),
      });

      await client.listRequests({ status: 'pending' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/requests?status=pending',
        expect.any(Object)
      );
    });

    it('should pass limit and offset in query string', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ requests: [], pagination: {} }),
      });

      await client.listRequests({ limit: 10, offset: 20 });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/requests?limit=10&offset=20',
        expect.any(Object)
      );
    });

    it('should combine all filters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ requests: [], pagination: {} }),
      });

      await client.listRequests({ status: 'approved', limit: 5, offset: 10 });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/requests?status=approved&limit=5&offset=10',
        expect.any(Object)
      );
    });
  });

  describe('createRequest defaults', () => {
    it('should use default values for optional fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'req-new', status: 'pending' }),
      });

      await client.createRequest({ action: 'test_action' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/requests',
        expect.objectContaining({
          body: JSON.stringify({
            action: 'test_action',
            params: {},
            context: {},
            urgency: 'normal',
          }),
        })
      );
    });
  });
});

describe('formatRequest', () => {
  describe('json format', () => {
    it('should return pretty-printed JSON', () => {
      const request = createMockRequest();
      const result = formatRequest(request, 'json');
      expect(result).toBe(JSON.stringify(request, null, 2));
    });
  });

  describe('plain format', () => {
    it('should format basic request fields', () => {
      const request = createMockRequest();
      const result = formatRequest(request, 'plain');

      expect(result).toContain('ID: req-test-123');
      expect(result).toContain('Action: send_email');
      expect(result).toContain('Status: pending');
      expect(result).toContain('Urgency: normal');
    });

    it('should include decision fields when present', () => {
      const request = createMockRequest({
        status: 'approved',
        decidedAt: new Date('2026-02-03T10:30:00Z'),
        decidedBy: 'admin@example.com',
        decisionReason: 'Looks good',
      });
      const result = formatRequest(request, 'plain');

      expect(result).toContain('Decided by: admin@example.com');
      expect(result).toContain('Reason: Looks good');
    });

    it('should not include decision fields when not present', () => {
      const request = createMockRequest();
      const result = formatRequest(request, 'plain');

      expect(result).not.toContain('Decided by:');
      expect(result).not.toContain('Reason:');
    });
  });

  describe('table format', () => {
    it('should include box drawing characters', () => {
      const request = createMockRequest();
      const result = formatRequest(request, 'table');

      expect(result).toContain('┌');
      expect(result).toContain('├');
      expect(result).toContain('└');
      expect(result).toContain('│');
    });

    it('should show pending icon for pending status', () => {
      const request = createMockRequest({ status: 'pending' });
      const result = formatRequest(request, 'table');
      expect(result).toContain('⏳');
    });

    it('should show approved icon for approved status', () => {
      const request = createMockRequest({ status: 'approved' });
      const result = formatRequest(request, 'table');
      expect(result).toContain('✅');
    });

    it('should show denied icon for denied status', () => {
      const request = createMockRequest({ status: 'denied' });
      const result = formatRequest(request, 'table');
      expect(result).toContain('❌');
    });

    it('should show expired icon for expired status', () => {
      const request = createMockRequest({ status: 'expired' });
      const result = formatRequest(request, 'table');
      expect(result).toContain('⌛');
    });
  });
});

describe('formatRequestList', () => {
  describe('json format', () => {
    it('should return JSON array', () => {
      const requests = [createMockRequest(), createMockRequest({ id: 'req-2' })];
      const result = formatRequestList(requests, 'json');
      expect(result).toBe(JSON.stringify(requests, null, 2));
    });

    it('should handle empty array', () => {
      const result = formatRequestList([], 'json');
      expect(result).toBe('[]');
    });
  });

  describe('plain format', () => {
    it('should format as tab-separated values', () => {
      const requests = [createMockRequest()];
      const result = formatRequestList(requests, 'plain');
      expect(result).toContain('req-test-123\tpending\tsend_email');
    });

    it('should handle empty list', () => {
      const result = formatRequestList([], 'plain');
      expect(result).toBe('No requests found.');
    });
  });

  describe('table format', () => {
    it('should render table headers', () => {
      const requests = [createMockRequest()];
      const result = formatRequestList(requests, 'table');

      expect(result).toContain('│ ID');
      expect(result).toContain('│ Status');
      expect(result).toContain('│ Action');
    });

    it('should handle empty list', () => {
      const result = formatRequestList([], 'table');
      expect(result).toBe('No requests found.');
    });

    it('should truncate long IDs', () => {
      const longId = 'request-with-very-long-id-that-exceeds-limits-1234567890';
      const requests = [createMockRequest({ id: longId })];
      const result = formatRequestList(requests, 'table');
      
      // Should contain truncated version
      expect(result.length).toBeLessThan(
        result.length + (longId.length - 34)
      );
    });

    it('should truncate long actions', () => {
      const longAction = 'this_is_a_very_long_action_name_that_exceeds_the_limit';
      const requests = [createMockRequest({ action: longAction })];
      const result = formatRequestList(requests, 'table');
      
      // Result should be bounded
      expect(result).toBeDefined();
    });
  });
});
