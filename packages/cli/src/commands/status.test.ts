// @agentgate/cli - Status command tests

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStatusCommand } from './status.js';

// Mock API client
const mockGetRequest = vi.fn();
vi.mock('../api.js', () => ({
  ApiClient: vi.fn().mockImplementation(() => ({
    getRequest: mockGetRequest,
  })),
  formatRequest: vi.fn((request, format) => {
    if (format === 'json') return JSON.stringify(request);
    return `Formatted: ${request.id}`;
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

describe('createStatusCommand', () => {
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

  it('should get request status by ID', async () => {
    mockGetRequest.mockResolvedValue({
      id: 'req-123',
      action: 'send_email',
      status: 'pending',
    });

    const cmd = createStatusCommand();
    await cmd.parseAsync(['node', 'test', 'req-123']);

    expect(mockGetRequest).toHaveBeenCalledWith('req-123');
    expect(consoleSpy).toHaveBeenCalledWith('Formatted: req-123');
  });

  it('should use JSON format with --json flag', async () => {
    mockGetRequest.mockResolvedValue({
      id: 'req-456',
      action: 'delete_file',
      status: 'approved',
    });

    const cmd = createStatusCommand();
    await cmd.parseAsync(['node', 'test', 'req-456', '--json']);

    expect(consoleSpy).toHaveBeenCalled();
  });

  it('should handle not found errors', async () => {
    mockGetRequest.mockRejectedValue(new Error('HTTP 404: Not found'));

    const cmd = createStatusCommand();

    await expect(
      cmd.parseAsync(['node', 'test', 'nonexistent-id'])
    ).rejects.toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to get status:',
      'HTTP 404: Not found'
    );
  });

  it('should handle network errors', async () => {
    mockGetRequest.mockRejectedValue(new Error('Network error'));

    const cmd = createStatusCommand();

    await expect(
      cmd.parseAsync(['node', 'test', 'req-123'])
    ).rejects.toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to get status:',
      'Network error'
    );
  });

  it('should handle non-Error exceptions', async () => {
    mockGetRequest.mockRejectedValue({ code: 'ECONNREFUSED' });

    const cmd = createStatusCommand();

    await expect(
      cmd.parseAsync(['node', 'test', 'req-123'])
    ).rejects.toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to get status:',
      { code: 'ECONNREFUSED' }
    );
  });

  it('should require requestId argument', async () => {
    const cmd = createStatusCommand();

    // Commander should handle missing required argument
    let errorThrown = false;
    cmd.exitOverride(() => {
      errorThrown = true;
      throw new Error('Missing argument');
    });

    await expect(cmd.parseAsync(['node', 'test'])).rejects.toThrow();
    expect(errorThrown).toBe(true);
  });
});
