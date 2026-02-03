// @agentgate/cli - Approve command tests

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApproveCommand } from './approve.js';

// Mock API client
const mockApproveRequest = vi.fn();
vi.mock('../api.js', () => ({
  ApiClient: vi.fn().mockImplementation(() => ({
    approveRequest: mockApproveRequest,
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

describe('createApproveCommand', () => {
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

  it('should approve request with ID only', async () => {
    mockApproveRequest.mockResolvedValue({
      id: 'req-123',
      status: 'approved',
    });

    const cmd = createApproveCommand();
    await cmd.parseAsync(['node', 'test', 'req-123']);

    expect(mockApproveRequest).toHaveBeenCalledWith({
      requestId: 'req-123',
      reason: undefined,
      decidedBy: undefined,
    });
  });

  it('should include reason when provided', async () => {
    mockApproveRequest.mockResolvedValue({
      id: 'req-123',
      status: 'approved',
    });

    const cmd = createApproveCommand();
    await cmd.parseAsync(['node', 'test', 'req-123', '--reason', 'Looks good to me']);

    expect(mockApproveRequest).toHaveBeenCalledWith({
      requestId: 'req-123',
      reason: 'Looks good to me',
      decidedBy: undefined,
    });
  });

  it('should include decidedBy when provided', async () => {
    mockApproveRequest.mockResolvedValue({
      id: 'req-123',
      status: 'approved',
      decidedBy: 'admin@example.com',
    });

    const cmd = createApproveCommand();
    await cmd.parseAsync(['node', 'test', 'req-123', '--by', 'admin@example.com']);

    expect(mockApproveRequest).toHaveBeenCalledWith({
      requestId: 'req-123',
      reason: undefined,
      decidedBy: 'admin@example.com',
    });
  });

  it('should combine reason and decidedBy', async () => {
    mockApproveRequest.mockResolvedValue({
      id: 'req-456',
      status: 'approved',
    });

    const cmd = createApproveCommand();
    await cmd.parseAsync([
      'node', 'test', 'req-456',
      '-r', 'Verified by security team',
      '-b', 'security@example.com',
    ]);

    expect(mockApproveRequest).toHaveBeenCalledWith({
      requestId: 'req-456',
      reason: 'Verified by security team',
      decidedBy: 'security@example.com',
    });
  });

  it('should show success message', async () => {
    mockApproveRequest.mockResolvedValue({
      id: 'req-123',
      status: 'approved',
    });

    const cmd = createApproveCommand();
    await cmd.parseAsync(['node', 'test', 'req-123']);

    expect(consoleSpy).toHaveBeenCalledWith('\n✅ Request approved successfully');
  });

  it('should use JSON format with --json flag', async () => {
    mockApproveRequest.mockResolvedValue({
      id: 'req-json',
      status: 'approved',
    });

    const cmd = createApproveCommand();
    await cmd.parseAsync(['node', 'test', 'req-json', '--json']);

    expect(consoleSpy).toHaveBeenCalled();
  });

  it('should handle API errors', async () => {
    mockApproveRequest.mockRejectedValue(new Error('Request not found'));

    const cmd = createApproveCommand();

    await expect(
      cmd.parseAsync(['node', 'test', 'invalid-id'])
    ).rejects.toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to approve request:',
      'Request not found'
    );
  });

  it('should handle already approved error', async () => {
    mockApproveRequest.mockRejectedValue(
      new Error('HTTP 400: Request already decided')
    );

    const cmd = createApproveCommand();

    await expect(
      cmd.parseAsync(['node', 'test', 'req-123'])
    ).rejects.toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to approve request:',
      'HTTP 400: Request already decided'
    );
  });

  it('should handle non-Error exceptions', async () => {
    mockApproveRequest.mockRejectedValue('Unknown error');

    const cmd = createApproveCommand();

    await expect(
      cmd.parseAsync(['node', 'test', 'req-123'])
    ).rejects.toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to approve request:',
      'Unknown error'
    );
  });
});
