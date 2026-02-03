// @agentgate/cli - API client tests

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from './api.js';

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
});
