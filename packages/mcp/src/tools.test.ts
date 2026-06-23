import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildListParams,
  buildAuditParams,
  formatResult,
  formatError,
  guardrailBlockResult,
  handleToolCall,
  authorizeTool,
  toolDefinitions,
  normalizeDecidedBy,
} from './tools.js';
import type { ApiConfig } from './types.js';

describe('guardrailBlockResult', () => {
  it('returns a synchronous isError result for a deny verdict (#14)', () => {
    const r = guardrailBlockResult({ decision: 'deny', reason: 'tool blocked' });
    expect(r?.isError).toBe(true);
    const text = JSON.stringify(r);
    expect(text).toContain('denied');
    expect(text).toContain('tool blocked');
  });

  it('returns a non-error pending result for requires_approval', () => {
    const r = guardrailBlockResult({ decision: 'requires_approval', requestId: 'req_1', reason: null });
    expect(r?.isError).toBeUndefined();
    expect(JSON.stringify(r)).toContain('pending');
  });

  it('returns null when allowed or no verdict (caller runs the tool)', () => {
    expect(guardrailBlockResult({ decision: 'allow' })).toBeNull();
    expect(guardrailBlockResult(null)).toBeNull();
  });
});

describe('buildListParams', () => {
  it('returns empty string when no filters provided', () => {
    expect(buildListParams({})).toBe('');
  });

  it('includes status filter', () => {
    const result = buildListParams({ status: 'pending' });
    expect(result).toBe('status=pending');
  });

  it('includes limit filter', () => {
    const result = buildListParams({ limit: 5 });
    expect(result).toBe('limit=5');
  });

  it('includes both status and limit', () => {
    const result = buildListParams({ status: 'approved', limit: 10 });
    expect(result).toContain('status=approved');
    expect(result).toContain('limit=10');
    expect(result).toContain('&');
  });
});

describe('formatResult', () => {
  it('formats object result as JSON', () => {
    const data = { id: '123', status: 'pending' };
    const result = formatResult(data);
    
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe('text');
    expect(JSON.parse(result.content[0]!.text)).toEqual(data);
    expect(result.isError).toBeUndefined();
  });

  it('formats array result as JSON', () => {
    const data = [{ id: '1' }, { id: '2' }];
    const result = formatResult(data);
    
    expect(JSON.parse(result.content[0]!.text)).toEqual(data);
  });

  it('formats null result', () => {
    const result = formatResult(null);
    expect(result.content[0]!.text).toBe('null');
  });
});

describe('formatError', () => {
  it('formats Error instance', () => {
    const error = new Error('Something went wrong');
    const result = formatError(error);
    
    expect(result.content[0]!.text).toBe('Error: Something went wrong');
    expect(result.isError).toBe(true);
  });

  it('formats non-Error value', () => {
    const result = formatError('string error');
    
    expect(result.content[0]!.text).toBe('Error: Unknown error');
    expect(result.isError).toBe(true);
  });

  it('formats undefined value', () => {
    const result = formatError(undefined);
    
    expect(result.content[0]!.text).toBe('Error: Unknown error');
    expect(result.isError).toBe(true);
  });
});

describe('toolDefinitions', () => {
  it('contains exactly 10 tools', () => {
    expect(toolDefinitions).toHaveLength(10);
  });

  it('has agentgate_request tool with required action', () => {
    const tool = toolDefinitions.find((t) => t.name === 'agentgate_request');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain('action');
  });

  it('has agentgate_get tool with required id', () => {
    const tool = toolDefinitions.find((t) => t.name === 'agentgate_get');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain('id');
  });

  it('has agentgate_list tool with no required fields', () => {
    const tool = toolDefinitions.find((t) => t.name === 'agentgate_list');
    expect(tool).toBeDefined();
    // agentgate_list has no required fields (all filters are optional)
    expect('required' in tool!.inputSchema).toBe(false);
  });

  it('has agentgate_decide tool with required id and decision', () => {
    const tool = toolDefinitions.find((t) => t.name === 'agentgate_decide');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain('id');
    expect(tool!.inputSchema.required).toContain('decision');
  });

  it('has agentgate_list_policies tool with no required fields', () => {
    const tool = toolDefinitions.find((t) => t.name === 'agentgate_list_policies');
    expect(tool).toBeDefined();
    expect('required' in tool!.inputSchema).toBe(false);
  });

  it('has agentgate_create_policy tool with required name and rules', () => {
    const tool = toolDefinitions.find((t) => t.name === 'agentgate_create_policy');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain('name');
    expect(tool!.inputSchema.required).toContain('rules');
  });

  it('has agentgate_update_policy tool with required id, name, and rules', () => {
    const tool = toolDefinitions.find((t) => t.name === 'agentgate_update_policy');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain('id');
    expect(tool!.inputSchema.required).toContain('name');
    expect(tool!.inputSchema.required).toContain('rules');
  });

  it('has agentgate_delete_policy tool with required id', () => {
    const tool = toolDefinitions.find((t) => t.name === 'agentgate_delete_policy');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain('id');
  });

  it('has agentgate_list_audit_logs tool with no required fields', () => {
    const tool = toolDefinitions.find((t) => t.name === 'agentgate_list_audit_logs');
    expect(tool).toBeDefined();
    expect('required' in tool!.inputSchema).toBe(false);
  });

  it('has agentgate_get_audit_actors tool with no required fields', () => {
    const tool = toolDefinitions.find((t) => t.name === 'agentgate_get_audit_actors');
    expect(tool).toBeDefined();
    expect('required' in tool!.inputSchema).toBe(false);
  });
});

describe('normalizeDecidedBy', () => {
  it('returns mcp:user for undefined', () => {
    expect(normalizeDecidedBy(undefined)).toBe('mcp:user');
  });

  it('returns mcp:user for empty string', () => {
    expect(normalizeDecidedBy('')).toBe('mcp:user');
  });

  it('preserves valid namespaced values', () => {
    expect(normalizeDecidedBy('mcp:custom-agent')).toBe('mcp:custom-agent');
    expect(normalizeDecidedBy('slack:U12345')).toBe('slack:U12345');
    expect(normalizeDecidedBy('dashboard:admin')).toBe('dashboard:admin');
  });

  it('prefixes with mcp: when no known namespace', () => {
    expect(normalizeDecidedBy('some-user')).toBe('mcp:some-user');
    expect(normalizeDecidedBy('admin')).toBe('mcp:admin');
  });

  it('prefixes with mcp: when namespace is unknown', () => {
    expect(normalizeDecidedBy('unknown:user')).toBe('mcp:unknown:user');
  });
});

describe('buildAuditParams', () => {
  it('returns empty string when no filters provided', () => {
    expect(buildAuditParams({})).toBe('');
  });

  it('includes action filter', () => {
    expect(buildAuditParams({ action: 'send_email' })).toBe('action=send_email');
  });

  it('includes multiple filters', () => {
    const result = buildAuditParams({ actor: 'mcp:user', limit: 10, offset: 20 });
    expect(result).toContain('actor=mcp%3Auser');
    expect(result).toContain('limit=10');
    expect(result).toContain('offset=20');
  });
});

describe('handleToolCall', () => {
  const config: ApiConfig = {
    baseUrl: 'http://localhost:3000',
    apiKey: 'test-key',
  };

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns error for unknown tool', async () => {
    const result = await handleToolCall(config, 'unknown_tool', {});

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Unknown tool: unknown_tool');
  });

  it('calls POST /api/requests for agentgate_request', async () => {
    const responseData = { id: 'req-123', status: 'pending' };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(responseData),
    });

    const result = await handleToolCall(config, 'agentgate_request', {
      action: 'send_email',
      params: { to: 'test@example.com' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/requests',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      })
    );
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text)).toEqual(responseData);
  });

  it('calls GET /api/requests/:id for agentgate_get', async () => {
    const responseData = { id: 'req-123', status: 'approved' };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(responseData),
    });

    const result = await handleToolCall(config, 'agentgate_get', {
      id: 'req-123',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/requests/req-123',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result.isError).toBeUndefined();
  });

  it('calls GET /api/requests with query params for agentgate_list', async () => {
    const responseData = { requests: [] };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(responseData),
    });

    await handleToolCall(config, 'agentgate_list', {
      status: 'pending',
      limit: 5,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/requests\?.*status=pending.*limit=5/),
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('calls POST /api/requests/:id/decide for agentgate_decide', async () => {
    const responseData = { id: 'req-123', status: 'approved' };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(responseData),
    });

    const result = await handleToolCall(config, 'agentgate_decide', {
      id: 'req-123',
      decision: 'approved',
      reason: 'Looks good',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/requests/req-123/decide',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"decision":"approved"'),
      })
    );
    expect(result.isError).toBeUndefined();
  });

  it('uses mcp:user as default decidedBy for agentgate_decide', async () => {
    const responseData = { id: 'req-123', status: 'approved' };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(responseData),
    });

    await handleToolCall(config, 'agentgate_decide', {
      id: 'req-123',
      decision: 'approved',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"decidedBy":"mcp:user"'),
      })
    );
  });

  it('preserves custom decidedBy when provided for agentgate_decide', async () => {
    const responseData = { id: 'req-123', status: 'approved' };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(responseData),
    });

    await handleToolCall(config, 'agentgate_decide', {
      id: 'req-123',
      decision: 'approved',
      decidedBy: 'mcp:custom-agent',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"decidedBy":"mcp:custom-agent"'),
      })
    );
  });

  it('handles API errors gracefully', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: () => Promise.resolve(JSON.stringify({ error: 'Invalid API key' })),
    });

    const result = await handleToolCall(config, 'agentgate_get', {
      id: 'req-123',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Invalid API key');
  });

  it('handles network errors gracefully', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));

    const result = await handleToolCall(config, 'agentgate_request', {
      action: 'test',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Network error');
  });

  // Policy tools
  it('calls GET /api/policies for agentgate_list_policies', async () => {
    const responseData = [{ id: 'pol-1', name: 'Test Policy' }];
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve(responseData),
    });

    const result = await handleToolCall(config, 'agentgate_list_policies', {});

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/policies',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text)).toEqual(responseData);
  });

  it('calls POST /api/policies for agentgate_create_policy', async () => {
    const responseData = { id: 'pol-1', name: 'New Policy' };
    fetchMock.mockResolvedValue({
      ok: true, status: 201,
      json: () => Promise.resolve(responseData),
    });

    const result = await handleToolCall(config, 'agentgate_create_policy', {
      name: 'New Policy',
      rules: [{ match: { action: 'send_email' }, decision: 'auto_approve' }],
      priority: 50,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/policies',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"name":"New Policy"'),
      })
    );
    expect(result.isError).toBeUndefined();
  });

  it('calls PUT /api/policies/:id for agentgate_update_policy', async () => {
    const responseData = { id: 'pol-1', name: 'Updated' };
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve(responseData),
    });

    const result = await handleToolCall(config, 'agentgate_update_policy', {
      id: 'pol-1',
      name: 'Updated',
      rules: [{ match: { action: '*' }, decision: 'route_to_human' }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/policies/pol-1',
      expect.objectContaining({ method: 'PUT' })
    );
    expect(result.isError).toBeUndefined();
  });

  it('calls DELETE /api/policies/:id for agentgate_delete_policy', async () => {
    const responseData = { success: true, id: 'pol-1' };
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve(responseData),
    });

    const result = await handleToolCall(config, 'agentgate_delete_policy', {
      id: 'pol-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/policies/pol-1',
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(result.isError).toBeUndefined();
  });

  // Audit tools
  it('calls GET /api/audit for agentgate_list_audit_logs', async () => {
    const responseData = { entries: [], pagination: { total: 0 } };
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve(responseData),
    });

    const result = await handleToolCall(config, 'agentgate_list_audit_logs', {
      actor: 'mcp:user',
      limit: 10,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/audit\?.*actor=mcp%3Auser.*limit=10/),
      expect.objectContaining({ method: 'GET' })
    );
    expect(result.isError).toBeUndefined();
  });

  it('calls GET /api/audit without params when no filters', async () => {
    const responseData = { entries: [], pagination: { total: 0 } };
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve(responseData),
    });

    await handleToolCall(config, 'agentgate_list_audit_logs', {});

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/audit',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('calls GET /api/audit/actors for agentgate_get_audit_actors', async () => {
    const responseData = { actors: ['mcp:user', 'system:auto'] };
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve(responseData),
    });

    const result = await handleToolCall(config, 'agentgate_get_audit_actors', {});

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/audit/actors',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text)).toEqual(responseData);
  });
});

describe('authorizeTool (MCP guardrail, #14)', () => {
  const config: ApiConfig = { baseUrl: 'http://localhost:3000', apiKey: 'test-key' };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs the tool name to /api/mcp/authorize and returns the verdict', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ decision: 'allow' }),
    });
    const verdict = await authorizeTool(config, 'file.read', { path: '/tmp' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/mcp/authorize',
      expect.objectContaining({ method: 'POST' }),
    );
    const sentBody = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(sentBody).toEqual({ toolName: 'file.read', params: { path: '/tmp' } });
    expect(verdict).toEqual({ decision: 'allow' });
  });

  it('passes through a requires_approval verdict', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ decision: 'requires_approval', status: 'pending', requestId: 'req-9' }),
    });
    const verdict = await authorizeTool(config, 'send_email', {});
    expect(verdict?.decision).toBe('requires_approval');
    expect(verdict?.requestId).toBe('req-9');
  });

  it('fails OPEN (returns null) on a network/auth error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('') });
    expect(await authorizeTool(config, 'file.read', {})).toBeNull();
  });
});
