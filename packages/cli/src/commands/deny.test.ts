// @agentgate/cli - Deny command tests

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDenyCommand } from './deny.js';

// Mock API client
const mockDenyRequest = vi.fn();
vi.mock('../api.js', () => ({
  ApiClient: vi.fn().mockImplementation(() => ({
    denyRequest: mockDenyRequest,
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

describe('createDenyCommand', () => {
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

  it('should deny request with ID only', async () => {
    mockDenyRequest.mockResolvedValue({
      id: 'req-123',
      status: 'denied',
    });

    const cmd = createDenyCommand();
    await cmd.parseAsync(['node', 'test', 'req-123']);

    expect(mockDenyRequest).toHaveBeenCalledWith({
      requestId: 'req-123',
      reason: undefined,
      decidedBy: undefined,
    });
  });

  it('should include reason when provided', async () => {
    mockDenyRequest.mockResolvedValue({
      id: 'req-123',
      status: 'denied',
    });

    const cmd = createDenyCommand();
    await cmd.parseAsync(['node', 'test', 'req-123', '--reason', 'Not authorized']);

    expect(mockDenyRequest).toHaveBeenCalledWith({
      requestId: 'req-123',
      reason: 'Not authorized',
      decidedBy: undefined,
    });
  });

  it('should include decidedBy when provided', async () => {
    mockDenyRequest.mockResolvedValue({
      id: 'req-123',
      status: 'denied',
      decidedBy: 'security@example.com',
    });

    const cmd = createDenyCommand();
    await cmd.parseAsync(['node', 'test', 'req-123', '--by', 'security@example.com']);

    expect(mockDenyRequest).toHaveBeenCalledWith({
      requestId: 'req-123',
      reason: undefined,
      decidedBy: 'security@example.com',
    });
  });

  it('should combine reason and decidedBy', async () => {
    mockDenyRequest.mockResolvedValue({
      id: 'req-456',
      status: 'denied',
    });

    const cmd = createDenyCommand();
    await cmd.parseAsync([
      'node', 'test', 'req-456',
      '-r', 'Policy violation detected',
      '-b', 'compliance@example.com',
    ]);

    expect(mockDenyRequest).toHaveBeenCalledWith({
      requestId: 'req-456',
      reason: 'Policy violation detected',
      decidedBy: 'compliance@example.com',
    });
  });

  it('should show denial message', async () => {
    mockDenyRequest.mockResolvedValue({
      id: 'req-123',
      status: 'denied',
    });

    const cmd = createDenyCommand();
    await cmd.parseAsync(['node', 'test', 'req-123']);

    expect(consoleSpy).toHaveBeenCalledWith('\n❌ Request denied');
  });

  it('should use JSON format with --json flag', async () => {
    mockDenyRequest.mockResolvedValue({
      id: 'req-json',
      status: 'denied',
    });

    const cmd = createDenyCommand();
    await cmd.parseAsync(['node', 'test', 'req-json', '--json']);

    expect(consoleSpy).toHaveBeenCalled();
  });

  it('should handle API errors', async () => {
    mockDenyRequest.mockRejectedValue(new Error('Request not found'));

    const cmd = createDenyCommand();

    await expect(
      cmd.parseAsync(['node', 'test', 'invalid-id'])
    ).rejects.toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to deny request:',
      'Request not found'
    );
  });

  it('should handle already decided error', async () => {
    mockDenyRequest.mockRejectedValue(
      new Error('HTTP 400: Request already decided')
    );

    const cmd = createDenyCommand();

    await expect(
      cmd.parseAsync(['node', 'test', 'req-123'])
    ).rejects.toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to deny request:',
      'HTTP 400: Request already decided'
    );
  });

  it('should handle network errors', async () => {
    mockDenyRequest.mockRejectedValue(new Error('ECONNREFUSED'));

    const cmd = createDenyCommand();

    await expect(
      cmd.parseAsync(['node', 'test', 'req-123'])
    ).rejects.toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to deny request:',
      'ECONNREFUSED'
    );
  });

  it('should handle non-Error exceptions', async () => {
    mockDenyRequest.mockRejectedValue({ message: 'custom error' });

    const cmd = createDenyCommand();

    await expect(
      cmd.parseAsync(['node', 'test', 'req-123'])
    ).rejects.toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to deny request:',
      { message: 'custom error' }
    );
  });
});
