import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '../policy-engine.js';
import type { ApprovalRequest, Policy } from '../types.js';

// Helper to create a minimal request
function createRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'test-request-1',
    action: 'test_action',
    params: {},
    context: {},
    status: 'pending',
    urgency: 'normal',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Helper to create a policy
function createPolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: 'test-policy-1',
    name: 'Test Policy',
    rules: [],
    priority: 1,
    enabled: true,
    ...overrides,
  };
}

describe('evaluatePolicy', () => {
  describe('exact match', () => {
    it('should match exact string value', () => {
      const request = createRequest({ action: 'send_email' });
      const policy = createPolicy({
        rules: [
          { match: { action: 'send_email' }, decision: 'auto_approve' },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      expect(result.decision).toBe('auto_approve');
      expect(result.matchedRule).toEqual(policy.rules[0]);
    });

    it('should not match when value differs', () => {
      const request = createRequest({ action: 'delete_file' });
      const policy = createPolicy({
        rules: [
          { match: { action: 'send_email' }, decision: 'auto_approve' },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      expect(result.decision).toBe('route_to_human');
      expect(result.matchedRule).toBeUndefined();
    });
  });

  describe('numeric comparisons', () => {
    it('should match $lt (less than)', () => {
      const request = createRequest({
        action: 'transfer_funds',
        context: { amount: 50 },
      });
      const policy = createPolicy({
        rules: [
          { match: { 'context.amount': { $lt: 100 } }, decision: 'auto_approve' },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      expect(result.decision).toBe('auto_approve');
    });

    it('should not match $lt when value is greater', () => {
      const request = createRequest({
        action: 'transfer_funds',
        context: { amount: 150 },
      });
      const policy = createPolicy({
        rules: [
          { match: { 'context.amount': { $lt: 100 } }, decision: 'auto_approve' },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      expect(result.decision).toBe('route_to_human');
    });

    it('should match $gt (greater than)', () => {
      const request = createRequest({
        action: 'transfer_funds',
        context: { amount: 150 },
      });
      const policy = createPolicy({
        rules: [
          { match: { 'context.amount': { $gt: 100 } }, decision: 'route_to_human' },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      expect(result.decision).toBe('route_to_human');
    });

    it('should match $lte (less than or equal)', () => {
      const request = createRequest({
        action: 'transfer_funds',
        context: { amount: 100 },
      });
      const policy = createPolicy({
        rules: [
          { match: { 'context.amount': { $lte: 100 } }, decision: 'auto_approve' },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      expect(result.decision).toBe('auto_approve');
    });

    it('should match $gte (greater than or equal)', () => {
      const request = createRequest({
        action: 'transfer_funds',
        context: { amount: 100 },
      });
      const policy = createPolicy({
        rules: [
          { match: { 'context.amount': { $gte: 100 } }, decision: 'route_to_agent' },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      expect(result.decision).toBe('route_to_agent');
    });
  });

  describe('$in matcher', () => {
    it('should match when value is in array', () => {
      const request = createRequest({ status: 'pending' });
      const policy = createPolicy({
        rules: [
          { match: { status: { $in: ['pending', 'approved'] } }, decision: 'auto_approve' },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      expect(result.decision).toBe('auto_approve');
    });

    it('should not match when value is not in array', () => {
      const request = createRequest({ status: 'denied' });
      const policy = createPolicy({
        rules: [
          { match: { status: { $in: ['pending', 'approved'] } }, decision: 'auto_approve' },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      expect(result.decision).toBe('route_to_human');
    });
  });

  describe('$regex matcher', () => {
    it('should match regex pattern', () => {
      const request = createRequest({ action: 'delete_user' });
      const policy = createPolicy({
        rules: [
          { match: { action: { $regex: '^delete_' } }, decision: 'route_to_human' },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      expect(result.decision).toBe('route_to_human');
    });

    it('should not match when regex does not match', () => {
      const request = createRequest({ action: 'create_user' });
      const policy = createPolicy({
        rules: [
          { match: { action: { $regex: '^delete_' } }, decision: 'auto_deny' },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      expect(result.decision).toBe('route_to_human');
    });

    it('should handle complex regex', () => {
      const request = createRequest({ action: 'email_send_newsletter' });
      const policy = createPolicy({
        rules: [
          { match: { action: { $regex: 'email.*newsletter' } }, decision: 'auto_approve' },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      expect(result.decision).toBe('auto_approve');
    });

    it('should treat unsafe (ReDoS) regex as non-match', () => {
      const request = createRequest({ action: 'aaaaaaaaaaaaaaaaaaaaaa!' });
      const policy = createPolicy({
        rules: [
          { match: { action: { $regex: '(a+)+$' } }, decision: 'auto_approve' },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      // Unsafe regex should not match — falls through to default
      expect(result.decision).toBe('route_to_human');
    });

    it('should treat another unsafe regex pattern as non-match', () => {
      const request = createRequest({ action: 'test' });
      const policy = createPolicy({
        rules: [
          { match: { action: { $regex: '(a+){10}$' } }, decision: 'auto_approve' },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      expect(result.decision).toBe('route_to_human');
    });

    it('should handle invalid regex gracefully', () => {
      const request = createRequest({ action: 'test' });
      const policy = createPolicy({
        rules: [
          { match: { action: { $regex: '[invalid' } }, decision: 'auto_approve' },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      expect(result.decision).toBe('route_to_human');
    });
  });

  describe('nested path matching', () => {
    it('should match deeply nested paths', () => {
      const request = createRequest({
        context: {
          user: {
            role: 'admin',
            department: 'engineering',
          },
        },
      });
      const policy = createPolicy({
        rules: [
          { match: { 'context.user.role': 'admin' }, decision: 'auto_approve' },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      expect(result.decision).toBe('auto_approve');
    });

    it('should not match when nested path does not exist', () => {
      const request = createRequest({
        context: {
          user: {
            name: 'John',
          },
        },
      });
      const policy = createPolicy({
        rules: [
          { match: { 'context.user.role': 'admin' }, decision: 'auto_approve' },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      expect(result.decision).toBe('route_to_human');
    });

    it('should match params at top level', () => {
      const request = createRequest({
        params: {
          recipient: 'user@example.com',
        },
      });
      const policy = createPolicy({
        rules: [
          { match: { 'params.recipient': 'user@example.com' }, decision: 'auto_approve' },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      expect(result.decision).toBe('auto_approve');
    });
  });

  describe('priority ordering', () => {
    it('should evaluate higher priority policies first', () => {
      const request = createRequest({ action: 'send_email' });
      const lowPriorityPolicy = createPolicy({
        id: 'low',
        priority: 10,
        rules: [
          { match: { action: 'send_email' }, decision: 'auto_deny' },
        ],
      });
      const highPriorityPolicy = createPolicy({
        id: 'high',
        priority: 1,
        rules: [
          { match: { action: 'send_email' }, decision: 'auto_approve' },
        ],
      });

      // Pass in wrong order to verify sorting
      const result = evaluatePolicy(request, [lowPriorityPolicy, highPriorityPolicy]);

      expect(result.decision).toBe('auto_approve');
    });
  });

  describe('disabled policies', () => {
    it('should skip disabled policies', () => {
      const request = createRequest({ action: 'send_email' });
      const disabledPolicy = createPolicy({
        enabled: false,
        priority: 1,
        rules: [
          { match: { action: 'send_email' }, decision: 'auto_deny' },
        ],
      });
      const enabledPolicy = createPolicy({
        enabled: true,
        priority: 10,
        rules: [
          { match: { action: 'send_email' }, decision: 'auto_approve' },
        ],
      });

      const result = evaluatePolicy(request, [disabledPolicy, enabledPolicy]);

      expect(result.decision).toBe('auto_approve');
    });
  });

  describe('default behavior', () => {
    it('should return route_to_human when no policies match', () => {
      const request = createRequest({ action: 'unknown_action' });
      const policy = createPolicy({
        rules: [
          { match: { action: 'send_email' }, decision: 'auto_approve' },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      expect(result.decision).toBe('route_to_human');
      expect(result.matchedRule).toBeUndefined();
    });

    it('should return route_to_human when no policies provided', () => {
      const request = createRequest({ action: 'any_action' });

      const result = evaluatePolicy(request, []);

      expect(result.decision).toBe('route_to_human');
    });
  });

  describe('multiple matchers', () => {
    it('should require all matchers to match (AND logic)', () => {
      const request = createRequest({
        action: 'transfer_funds',
        context: { amount: 50 },
      });
      const policy = createPolicy({
        rules: [
          {
            match: {
              action: 'transfer_funds',
              'context.amount': { $lt: 100 },
            },
            decision: 'auto_approve',
          },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      expect(result.decision).toBe('auto_approve');
    });

    it('should not match when one matcher fails', () => {
      const request = createRequest({
        action: 'transfer_funds',
        context: { amount: 150 },
      });
      const policy = createPolicy({
        rules: [
          {
            match: {
              action: 'transfer_funds',
              'context.amount': { $lt: 100 },
            },
            decision: 'auto_approve',
          },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      expect(result.decision).toBe('route_to_human');
    });
  });

  describe('rule metadata', () => {
    it('should include approvers and channels from matched rule', () => {
      const request = createRequest({ action: 'send_email' });
      const policy = createPolicy({
        rules: [
          {
            match: { action: 'send_email' },
            decision: 'route_to_human',
            approvers: ['user1', 'user2'],
            channels: ['#approvals', '@manager'],
          },
        ],
      });

      const result = evaluatePolicy(request, [policy]);

      expect(result.decision).toBe('route_to_human');
      expect(result.approvers).toEqual(['user1', 'user2']);
      expect(result.channels).toEqual(['#approvals', '@manager']);
    });
  });

  describe('scope filtering (per-agent / per-tool)', () => {
    const denyEmail = { match: { action: 'send_email' }, decision: 'auto_deny' as const };

    it('per_agent: applies only to agents in agentIds (acceptance criterion)', () => {
      const request = createRequest({ action: 'send_email' });
      const policy = createPolicy({
        scope: 'per_agent',
        agentIds: ['agent1', 'agent2'],
        rules: [denyEmail],
      });

      expect(evaluatePolicy(request, [policy], { agentId: 'agent1' }).decision).toBe('auto_deny');
      expect(evaluatePolicy(request, [policy], { agentId: 'agent2' }).decision).toBe('auto_deny');
      // agent3 is not in the list → policy ignored → safe default
      expect(evaluatePolicy(request, [policy], { agentId: 'agent3' }).decision).toBe('route_to_human');
    });

    it('per_agent: fails closed when no agent is verified', () => {
      const request = createRequest({ action: 'send_email' });
      const policy = createPolicy({ scope: 'per_agent', agentIds: ['agent1'], rules: [denyEmail] });
      // no context, and explicit null → the per_agent deny is skipped, not applied
      expect(evaluatePolicy(request, [policy]).decision).toBe('route_to_human');
      expect(evaluatePolicy(request, [policy], { agentId: null }).decision).toBe('route_to_human');
    });

    it('global (and absent scope) applies regardless of agent', () => {
      const request = createRequest({ action: 'send_email' });
      const globalP = createPolicy({ scope: 'global', rules: [denyEmail] });
      const legacyP = createPolicy({ rules: [denyEmail] }); // scope undefined → global
      expect(evaluatePolicy(request, [globalP], { agentId: 'anyone' }).decision).toBe('auto_deny');
      expect(evaluatePolicy(request, [legacyP]).decision).toBe('auto_deny');
    });

    it('mixed global + per_agent: agent3 sees only global, agent1 sees the higher-priority per_agent rule', () => {
      const request = createRequest({ action: 'send_email' });
      const globalApprove = createPolicy({
        id: 'g', scope: 'global', priority: 10,
        rules: [{ match: { action: 'send_email' }, decision: 'auto_approve' }],
      });
      const agentDeny = createPolicy({
        id: 'a', scope: 'per_agent', agentIds: ['agent1'], priority: 1,
        rules: [denyEmail],
      });
      expect(evaluatePolicy(request, [globalApprove, agentDeny], { agentId: 'agent3' }).decision).toBe('auto_approve');
      expect(evaluatePolicy(request, [globalApprove, agentDeny], { agentId: 'agent1' }).decision).toBe('auto_deny');
    });

    it('per_tool: applies only when the action is in toolIds', () => {
      const policy = createPolicy({ scope: 'per_tool', toolIds: ['send_email'], rules: [denyEmail] });
      expect(evaluatePolicy(createRequest({ action: 'send_email' }), [policy], { tool: 'send_email' }).decision).toBe('auto_deny');
      expect(evaluatePolicy(createRequest({ action: 'delete_db' }), [policy], { tool: 'delete_db' }).decision).toBe('route_to_human');
    });

    it('per_agent with empty/undefined agentIds never matches', () => {
      const request = createRequest({ action: 'send_email' });
      const empty = createPolicy({ scope: 'per_agent', agentIds: [], rules: [denyEmail] });
      const missing = createPolicy({ scope: 'per_agent', rules: [denyEmail] });
      expect(evaluatePolicy(request, [empty], { agentId: 'agent1' }).decision).toBe('route_to_human');
      expect(evaluatePolicy(request, [missing], { agentId: 'agent1' }).decision).toBe('route_to_human');
    });

    it('unknown scope value is excluded (fail-safe)', () => {
      const request = createRequest({ action: 'send_email' });
      const weird = createPolicy({ scope: 'bogus' as unknown as Policy['scope'], rules: [denyEmail] });
      expect(evaluatePolicy(request, [weird], { agentId: 'agent1' }).decision).toBe('route_to_human');
    });
  });
});
