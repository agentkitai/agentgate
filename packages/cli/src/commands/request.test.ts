// @agentgate/cli - Request command tests

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequestCommand } from './request.js';

// Mock API client
const mockCreateRequest = vi.fn();
vi.mock('../api.js', () => ({
  ApiClient: vi.fn().mockImplementation(() => ({
    createRequest: mockCreateRequest,
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

describe('createRequestCommand', () => {
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

  it('should create request with action only', async () => {
    mockCreateRequest.mockResolvedValue({
      id: 'req-new',
      action: 'send_email',
      status: 'pending',
    });

    const cmd = createRequestCommand();
    await cmd.parseAsync(['node', 'test', 'send_email']);

    expect(mockCreateRequest).toHaveBeenCalledWith({
      action: 'send_email',
      params: {},
      context: {},
      urgency: 'normal',
    });
  });

  it('should parse params JSON', async () => {
    mockCreateRequest.mockResolvedValue({ id: 'req-1', status: 'pending' });

    const cmd = createRequestCommand();
    await cmd.parseAsync([
      'node', 'test', 'send_email',
      '--params', '{"to":"test@example.com","subject":"Hello"}'
    ]);

    expect(mockCreateRequest).toHaveBeenCalledWith({
      action: 'send_email',
      params: { to: 'test@example.com', subject: 'Hello' },
      context: {},
      urgency: 'normal',
    });
  });

  it('should parse context JSON', async () => {
    mockCreateRequest.mockResolvedValue({ id: 'req-1', status: 'pending' });

    const cmd = createRequestCommand();
    await cmd.parseAsync([
      'node', 'test', 'send_email',
      '--context', '{"source":"agent","session":"abc"}'
    ]);

    expect(mockCreateRequest).toHaveBeenCalledWith({
      action: 'send_email',
      params: {},
      context: { source: 'agent', session: 'abc' },
      urgency: 'normal',
    });
  });

  it('should set urgency level', async () => {
    mockCreateRequest.mockResolvedValue({ id: 'req-1', status: 'pending' });

    const cmd = createRequestCommand();

    for (const urgency of ['low', 'normal', 'high', 'critical']) {
      await cmd.parseAsync(['node', 'test', 'test_action', '-u', urgency]);
      expect(mockCreateRequest).toHaveBeenLastCalledWith(
        expect.objectContaining({ urgency })
      );
    }
  });

  it('should reject invalid urgency', async () => {
    const cmd = createRequestCommand();

    await expect(
      cmd.parseAsync(['node', 'test', 'send_email', '--urgency', 'emergency'])
    ).rejects.toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Invalid urgency level. Must be: low, normal, high, critical'
    );
  });

  it('should reject invalid params JSON', async () => {
    const cmd = createRequestCommand();

    await expect(
      cmd.parseAsync(['node', 'test', 'send_email', '--params', 'not-json'])
    ).rejects.toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid JSON for params');
  });

  it('should reject invalid context JSON', async () => {
    const cmd = createRequestCommand();

    await expect(
      cmd.parseAsync(['node', 'test', 'send_email', '--context', '{broken}'])
    ).rejects.toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid JSON for context');
  });

  it('should use JSON format with --json flag', async () => {
    mockCreateRequest.mockResolvedValue({
      id: 'req-json',
      action: 'test',
      status: 'pending',
    });

    const cmd = createRequestCommand();
    await cmd.parseAsync(['node', 'test', 'test_action', '--json']);

    expect(consoleSpy).toHaveBeenCalled();
  });

  it('should handle API errors', async () => {
    mockCreateRequest.mockRejectedValue(new Error('Server unavailable'));

    const cmd = createRequestCommand();

    await expect(
      cmd.parseAsync(['node', 'test', 'send_email'])
    ).rejects.toThrow('process.exit(1)');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to create request:',
      'Server unavailable'
    );
  });

  it('should combine all options', async () => {
    mockCreateRequest.mockResolvedValue({ id: 'req-full', status: 'pending' });

    const cmd = createRequestCommand();
    await cmd.parseAsync([
      'node', 'test', 'delete_user',
      '-p', '{"userId":"123"}',
      '-c', '{"reason":"requested"}',
      '-u', 'high',
    ]);

    expect(mockCreateRequest).toHaveBeenCalledWith({
      action: 'delete_user',
      params: { userId: '123' },
      context: { reason: 'requested' },
      urgency: 'high',
    });
  });
});
