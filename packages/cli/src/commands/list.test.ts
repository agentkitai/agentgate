// @agentgate/cli - List command tests

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createListCommand } from './list.js';

// Mock API client
const mockListRequests = vi.fn();
vi.mock('../api.js', () => ({
  ApiClient: vi.fn().mockImplementation(() => ({
    listRequests: mockListRequests,
  })),
  formatRequestList: vi.fn((requests, format) => {
    if (format === 'json') return JSON.stringify(requests);
    return `Formatted: ${requests.length} requests`;
  }),
}));

// Mock config
vi.mock('../config.js', () => ({
  getResolvedConfig: () => ({
    serverUrl: 'http://localhost:3000',
    apiKey: 'test-key',
    timeout: 5000,
    outputFormat: 'table',
  }),
}));

describe('createListCommand', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('should list requests with default options', async () => {
    mockListRequests.mockResolvedValue({
      requests: [{ id: 'req-1', action: 'test', status: 'pending' }],
      pagination: { total: 1, limit: 20, offset: 0, hasMore: false },
    });

    const cmd = createListCommand();
    await cmd.parseAsync(['node', 'test']);

    expect(mockListRequests).toHaveBeenCalledWith({
      status: undefined,
      limit: 20,
      offset: 0,
    });
  });

  it('should filter by status', async () => {
    mockListRequests.mockResolvedValue({
      requests: [],
      pagination: { total: 0, limit: 20, offset: 0, hasMore: false },
    });

    const cmd = createListCommand();
    await cmd.parseAsync(['node', 'test', '--status', 'pending']);

    expect(mockListRequests).toHaveBeenCalledWith({
      status: 'pending',
      limit: 20,
      offset: 0,
    });
  });

  it('should accept all valid status values', async () => {
    mockListRequests.mockResolvedValue({
      requests: [],
      pagination: { total: 0, limit: 20, offset: 0, hasMore: false },
    });

    const cmd = createListCommand();

    for (const status of ['pending', 'approved', 'denied', 'expired']) {
      await cmd.parseAsync(['node', 'test', '-s', status]);
      expect(mockListRequests).toHaveBeenLastCalledWith(
        expect.objectContaining({ status })
      );
    }
  });

  it('should reject invalid status', async () => {
    const cmd = createListCommand();

    await expect(
      cmd.parseAsync(['node', 'test', '--status', 'invalid'])
    ).rejects.toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Invalid status. Must be: pending, approved, denied, expired'
    );
  });

  it('should apply limit option', async () => {
    mockListRequests.mockResolvedValue({
      requests: [],
      pagination: { total: 0, limit: 10, offset: 0, hasMore: false },
    });

    const cmd = createListCommand();
    await cmd.parseAsync(['node', 'test', '--limit', '10']);

    expect(mockListRequests).toHaveBeenCalledWith({
      status: undefined,
      limit: 10,
      offset: 0,
    });
  });

  it('should apply offset option', async () => {
    mockListRequests.mockResolvedValue({
      requests: [],
      pagination: { total: 100, limit: 20, offset: 40, hasMore: true },
    });

    const cmd = createListCommand();
    await cmd.parseAsync(['node', 'test', '--offset', '40']);

    expect(mockListRequests).toHaveBeenCalledWith({
      status: undefined,
      limit: 20,
      offset: 40,
    });
  });

  it('should reject invalid limit', async () => {
    const cmd = createListCommand();

    await expect(
      cmd.parseAsync(['node', 'test', '--limit', '0'])
    ).rejects.toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Invalid limit. Must be a positive number.'
    );
  });

  it('should reject non-numeric limit', async () => {
    const cmd = createListCommand();

    await expect(
      cmd.parseAsync(['node', 'test', '-l', 'abc'])
    ).rejects.toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Invalid limit. Must be a positive number.'
    );
  });

  it('should reject negative offset', async () => {
    const cmd = createListCommand();

    await expect(
      cmd.parseAsync(['node', 'test', '--offset', '-1'])
    ).rejects.toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Invalid offset. Must be a non-negative number.'
    );
  });

  it('should use JSON format with --json flag', async () => {
    mockListRequests.mockResolvedValue({
      requests: [{ id: 'req-1' }],
      pagination: { total: 1, limit: 20, offset: 0, hasMore: false },
    });

    const cmd = createListCommand();
    await cmd.parseAsync(['node', 'test', '--json']);

    expect(consoleSpy).toHaveBeenCalled();
  });

  it('should show pagination hint when more results exist', async () => {
    mockListRequests.mockResolvedValue({
      requests: [{ id: 'req-1' }],
      pagination: { total: 100, limit: 20, offset: 0, hasMore: true },
    });

    const cmd = createListCommand();
    await cmd.parseAsync(['node', 'test']);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Use --offset to paginate')
    );
  });

  it('should handle API errors', async () => {
    mockListRequests.mockRejectedValue(new Error('Network error'));

    const cmd = createListCommand();

    await expect(cmd.parseAsync(['node', 'test'])).rejects.toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to list requests:',
      'Network error'
    );
  });

  it('should handle non-Error exceptions', async () => {
    mockListRequests.mockRejectedValue('string error');

    const cmd = createListCommand();

    await expect(cmd.parseAsync(['node', 'test'])).rejects.toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to list requests:',
      'string error'
    );
  });
});
