// @agentgate/sdk - Tests for AgentGateClient

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentGateClient } from './client.js';
import { AgentGateError, TimeoutError } from './errors.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('AgentGateClient', () => {
  let client: AgentGateClient;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    client = new AgentGateClient({
      baseUrl: 'http://localhost:3000',
      apiKey: 'test-api-key',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper to create a mock Response
  function mockResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'Content-Type': 'application/json', ...headers }),
      json: () => Promise.resolve(data),
    };
  }

  // Sample approval request data from API
  const sampleRequestData = {
    id: 'req_123',
    action: 'send_email',
    params: { to: 'user@example.com', subject: 'Hello' },
    context: { agentId: 'agent_1' },
    status: 'pending' as const,
    urgency: 'normal' as const,
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T10:00:00.000Z',
  };

  describe('constructor', () => {
    it('should remove trailing slash from baseUrl', () => {
      const client1 = new AgentGateClient({ baseUrl: 'http://localhost:3000/' });
      
      // We can verify by making a request and checking the URL
      mockFetch.mockResolvedValueOnce(mockResponse({ requests: [], pagination: {} }));
      client1.listRequests();
      
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/requests',
        expect.any(Object)
      );
    });

    it('should remove multiple trailing slashes from baseUrl', () => {
      const client = new AgentGateClient({ baseUrl: 'http://localhost:3000///' });
      
      mockFetch.mockResolvedValueOnce(mockResponse({ requests: [], pagination: {} }));
      client.listRequests();
      
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/requests',
        expect.any(Object)
      );
    });
  });

  describe('request()', () => {
    it('should create an approval request with minimal options', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(sampleRequestData));

      const result = await client.request({ action: 'send_email' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/requests',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-api-key',
          }),
          body: JSON.stringify({
            action: 'send_email',
            params: {},
            context: {},
            urgency: 'normal',
            expiresAt: undefined,
          }),
        })
      );

      expect(result.id).toBe('req_123');
      expect(result.action).toBe('send_email');
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('should create an approval request with all options', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(sampleRequestData));

      const expiresAt = new Date('2024-01-15T12:00:00.000Z');
      const result = await client.request({
        action: 'transfer_funds',
        params: { amount: 1000, currency: 'USD' },
        context: { agentId: 'agent_1', reason: 'Payment' },
        urgency: 'high',
        expiresAt,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/requests',
        expect.objectContaining({
          body: JSON.stringify({
            action: 'transfer_funds',
            params: { amount: 1000, currency: 'USD' },
            context: { agentId: 'agent_1', reason: 'Payment' },
            urgency: 'high',
            expiresAt: '2024-01-15T12:00:00.000Z',
          }),
        })
      );

      expect(result.id).toBe('req_123');
    });

    it('should parse date fields correctly', async () => {
      const dataWithDates = {
        ...sampleRequestData,
        decidedAt: '2024-01-15T10:05:00.000Z',
        expiresAt: '2024-01-15T12:00:00.000Z',
      };
      mockFetch.mockResolvedValueOnce(mockResponse(dataWithDates));

      const result = await client.request({ action: 'test' });

      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
      expect(result.decidedAt).toBeInstanceOf(Date);
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(result.decidedAt?.toISOString()).toBe('2024-01-15T10:05:00.000Z');
    });
  });

  describe('getRequest()', () => {
    it('should fetch a request by ID', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(sampleRequestData));

      const result = await client.getRequest('req_123');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/requests/req_123',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
          }),
        })
      );

      expect(result.id).toBe('req_123');
      expect(result.status).toBe('pending');
    });

    it('should throw AgentGateError for 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ message: 'Request not found', code: 'NOT_FOUND' }),
      });

      await expect(client.getRequest('nonexistent')).rejects.toThrow(AgentGateError);
      await mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ message: 'Request not found', code: 'NOT_FOUND' }),
      });
      
      try {
        await client.getRequest('nonexistent');
      } catch (error) {
        expect(error).toBeInstanceOf(AgentGateError);
        expect((error as AgentGateError).statusCode).toBe(404);
        expect((error as AgentGateError).code).toBe('NOT_FOUND');
        expect((error as AgentGateError).message).toBe('Request not found');
      }
    });
  });

  describe('listRequests()', () => {
    it('should list requests without filters', async () => {
      const listData = {
        requests: [sampleRequestData, { ...sampleRequestData, id: 'req_456' }],
        pagination: { total: 2, limit: 20, offset: 0 },
      };
      mockFetch.mockResolvedValueOnce(mockResponse(listData));

      const result = await client.listRequests();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/requests',
        expect.any(Object)
      );

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('req_123');
      expect(result[1].id).toBe('req_456');
    });

    it('should list requests with status filter', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ requests: [], pagination: {} }));

      await client.listRequests({ status: 'pending' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/requests?status=pending',
        expect.any(Object)
      );
    });

    it('should list requests with multiple filters', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ requests: [], pagination: {} }));

      await client.listRequests({
        status: 'approved',
        action: 'send_email',
        limit: 10,
        offset: 5,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('status=approved');
      expect(url).toContain('action=send_email');
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=5');
    });

    it('should parse date fields in list results', async () => {
      const listData = {
        requests: [sampleRequestData],
        pagination: {},
      };
      mockFetch.mockResolvedValueOnce(mockResponse(listData));

      const result = await client.listRequests();

      expect(result[0].createdAt).toBeInstanceOf(Date);
      expect(result[0].updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('waitForDecision()', () => {
    it('should return immediately if already decided', async () => {
      const approvedRequest = {
        ...sampleRequestData,
        status: 'approved',
        decidedAt: '2024-01-15T10:05:00.000Z',
        decidedBy: 'user_1',
      };
      mockFetch.mockResolvedValueOnce(mockResponse(approvedRequest));

      const result = await client.waitForDecision('req_123');

      expect(result.status).toBe('approved');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should poll until decision is made', async () => {
      // First two calls return pending, third returns approved
      mockFetch
        .mockResolvedValueOnce(mockResponse({ ...sampleRequestData, status: 'pending' }))
        .mockResolvedValueOnce(mockResponse({ ...sampleRequestData, status: 'pending' }))
        .mockResolvedValueOnce(mockResponse({ ...sampleRequestData, status: 'approved' }));

      const promise = client.waitForDecision('req_123', { pollInterval: 1000 });

      // Advance time for first poll
      await vi.advanceTimersByTimeAsync(1000);
      // Advance time for second poll
      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(result.status).toBe('approved');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should throw TimeoutError when timeout exceeded', async () => {
      // Always return pending
      mockFetch.mockResolvedValue(mockResponse({ ...sampleRequestData, status: 'pending' }));

      // Start the wait and immediately set up to catch the error
      let caughtError: Error | null = null;
      const promise = client.waitForDecision('req_123', {
        timeout: 5000,
        pollInterval: 1000,
      }).catch((e) => { caughtError = e; });

      // Advance time past timeout (each iteration takes pollInterval)
      // After 5 polls of 1000ms each = 5000ms, the timeout should trigger
      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      await promise;

      expect(caughtError).toBeInstanceOf(TimeoutError);
      expect((caughtError as TimeoutError).message).toMatch(/Timed out waiting for decision/);
    });

    it('should use default timeout of 5 minutes', async () => {
      mockFetch.mockResolvedValue(mockResponse({ ...sampleRequestData, status: 'pending' }));

      let caughtError: Error | null = null;
      const promise = client.waitForDecision('req_123', { pollInterval: 60000 })
        .catch((e) => { caughtError = e; });

      // Advance time to 4 minutes
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
      
      // Should still be polling, no error yet
      expect(mockFetch).toHaveBeenCalled();
      expect(caughtError).toBeNull();

      // Advance past 5 minutes (another 2 minutes)
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

      await promise;

      expect(caughtError).toBeInstanceOf(TimeoutError);
    });

    it('should handle denied status', async () => {
      const deniedRequest = {
        ...sampleRequestData,
        status: 'denied',
        decidedAt: '2024-01-15T10:05:00.000Z',
        decidedBy: 'user_1',
        decisionReason: 'Policy violation',
      };
      mockFetch.mockResolvedValueOnce(mockResponse(deniedRequest));

      const result = await client.waitForDecision('req_123');

      expect(result.status).toBe('denied');
      expect(result.decisionReason).toBe('Policy violation');
    });

    it('should handle expired status', async () => {
      const expiredRequest = {
        ...sampleRequestData,
        status: 'expired',
        expiresAt: '2024-01-15T10:00:00.000Z',
      };
      mockFetch.mockResolvedValueOnce(mockResponse(expiredRequest));

      const result = await client.waitForDecision('req_123');

      expect(result.status).toBe('expired');
    });
  });

  // confirm() tests removed — method was dead code (endpoint never existed)

  describe('error handling', () => {
    it('should throw AgentGateError with status code', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ message: 'Internal server error' }),
      });

      try {
        await client.request({ action: 'test' });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AgentGateError);
        expect((error as AgentGateError).statusCode).toBe(500);
        expect((error as AgentGateError).message).toBe('Internal server error');
      }
    });

    it('should handle error response without JSON body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        headers: new Headers({ 'Content-Type': 'text/html' }),
        json: () => Promise.reject(new Error('Not JSON')),
      });

      try {
        await client.request({ action: 'test' });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AgentGateError);
        expect((error as AgentGateError).statusCode).toBe(502);
        expect((error as AgentGateError).message).toBe('Request failed with status 502');
      }
    });

    it('should include error code when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ message: 'Invalid action', code: 'INVALID_ACTION' }),
      });

      try {
        await client.request({ action: '' });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AgentGateError);
        expect((error as AgentGateError).code).toBe('INVALID_ACTION');
      }
    });

    it('should work without API key', async () => {
      const clientNoAuth = new AgentGateClient({ baseUrl: 'http://localhost:3000' });
      mockFetch.mockResolvedValueOnce(mockResponse(sampleRequestData));

      await clientNoAuth.request({ action: 'test' });

      const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });
  });
});

describe('errors', () => {
  describe('AgentGateError', () => {
    it('should have correct properties', () => {
      const error = new AgentGateError('Test error', 400, 'TEST_CODE');

      expect(error.name).toBe('AgentGateError');
      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('TEST_CODE');
      expect(error).toBeInstanceOf(Error);
    });

    it('should work without code', () => {
      const error = new AgentGateError('Test error', 500);

      expect(error.code).toBeUndefined();
      expect(error.statusCode).toBe(500);
    });
  });

  describe('TimeoutError', () => {
    it('should have correct properties', () => {
      const error = new TimeoutError('Custom timeout message');

      expect(error.name).toBe('TimeoutError');
      expect(error.message).toBe('Custom timeout message');
      expect(error.statusCode).toBe(408);
      expect(error.code).toBe('TIMEOUT');
      expect(error).toBeInstanceOf(AgentGateError);
      expect(error).toBeInstanceOf(Error);
    });

    it('should use default message', () => {
      const error = new TimeoutError();

      expect(error.message).toBe('Request timed out');
    });
  });
});
