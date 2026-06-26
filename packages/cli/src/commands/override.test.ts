// @agentkitai/agentgate-cli - Override command tests (#14)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOverrideCommand } from './override.js';

const mockCreateOverride = vi.fn();
const mockListOverrides = vi.fn();
const mockDeleteOverride = vi.fn();

// Keep the real formatOverrideList so tests verify actual user-facing output.
vi.mock('../api.js', async (importActual) => ({
  ...(await importActual<typeof import('../api.js')>()),
  ApiClient: vi.fn().mockImplementation(() => ({
    createOverride: mockCreateOverride,
    listOverrides: mockListOverrides,
    deleteOverride: mockDeleteOverride,
  })),
}));

vi.mock('../config.js', () => ({
  getResolvedConfig: () => ({ serverUrl: 'http://localhost:3000', apiKey: 'k', timeout: 5000, outputFormat: 'plain' }),
}));

describe('createOverrideCommand', () => {
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
    // Restore only these spies — NOT vi.restoreAllMocks(), which would also strip
    // the ApiClient vi.fn() implementation and break later tests.
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('creates a deny override with the parsed options and renders it', async () => {
    mockCreateOverride.mockResolvedValue({
      id: 'ovr_1', agentId: 'agt_1', toolPattern: 'fs.*', action: 'deny', reason: 'risky', createdAt: 'now', expiresAt: null,
    });
    const cmd = createOverrideCommand();
    await cmd.parseAsync(['node', 'test', 'create', '-a', 'agt_1', '-t', 'fs.*', '--action', 'deny', '-r', 'risky', '--ttl', '300']);
    expect(mockCreateOverride).toHaveBeenCalledWith({
      agentId: 'agt_1',
      toolPattern: 'fs.*',
      action: 'deny',
      reason: 'risky',
      ttlSeconds: 300,
    });
    // Real formatOverrideList output reaches the user with the deny action + tool.
    const out = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(out).toContain('deny');
    expect(out).toContain('fs.*');
  });

  it('defaults action to require_approval', async () => {
    mockCreateOverride.mockResolvedValue({ id: 'ovr_2', action: 'require_approval' });
    const cmd = createOverrideCommand();
    await cmd.parseAsync(['node', 'test', 'create', '-a', 'agt_1', '-t', 'deploy']);
    expect(mockCreateOverride).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'require_approval', ttlSeconds: undefined }),
    );
  });

  it('rejects an invalid action without calling the API', async () => {
    const cmd = createOverrideCommand();
    await expect(
      cmd.parseAsync(['node', 'test', 'create', '-a', 'agt_1', '-t', 'x', '--action', 'nuke']),
    ).rejects.toThrow('process.exit(1)');
    expect(mockCreateOverride).not.toHaveBeenCalled();
  });

  it('rejects a non-positive ttl', async () => {
    const cmd = createOverrideCommand();
    await expect(
      cmd.parseAsync(['node', 'test', 'create', '-a', 'agt_1', '-t', 'x', '--ttl', '0']),
    ).rejects.toThrow('process.exit(1)');
    expect(mockCreateOverride).not.toHaveBeenCalled();
  });

  it('lists overrides, rendering the deny action', async () => {
    mockListOverrides.mockResolvedValue({
      overrides: [{ id: 'ovr_1', agentId: 'agt_1', toolPattern: 'fs.*', action: 'deny', reason: null, createdAt: 'now', expiresAt: null }],
    });
    const cmd = createOverrideCommand();
    await cmd.parseAsync(['node', 'test', 'list']);
    expect(mockListOverrides).toHaveBeenCalled();
    expect(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('deny');
  });

  it('deletes an override by id', async () => {
    mockDeleteOverride.mockResolvedValue({ success: true, id: 'ovr_1' });
    const cmd = createOverrideCommand();
    await cmd.parseAsync(['node', 'test', 'rm', 'ovr_1']);
    expect(mockDeleteOverride).toHaveBeenCalledWith('ovr_1');
  });

  it('exits non-zero on an API error', async () => {
    mockCreateOverride.mockRejectedValue(new Error('HTTP 400: bad'));
    const cmd = createOverrideCommand();
    await expect(
      cmd.parseAsync(['node', 'test', 'create', '-a', 'agt_1', '-t', 'x', '--action', 'deny']),
    ).rejects.toThrow('process.exit(1)');
    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to create override:', 'HTTP 400: bad');
  });
});
