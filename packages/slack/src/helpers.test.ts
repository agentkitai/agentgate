import { describe, it, expect } from 'vitest';
import type { ApprovalRequest } from '@agentgate/core';
import {
  truncate,
  formatJson,
  getUrgencyEmoji,
  buildApprovalBlocks,
  buildDecidedBlocks,
} from './helpers.js';

describe('truncate', () => {
  it('returns string unchanged if shorter than maxLen', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('returns string unchanged if equal to maxLen', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('truncates and adds ellipsis if longer than maxLen', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });

  it('handles edge case of very short maxLen', () => {
    expect(truncate('hello', 4)).toBe('h...');
  });
});

describe('formatJson', () => {
  it('formats JSON with indentation', () => {
    const obj = { key: 'value' };
    const result = formatJson(obj);
    expect(result).toContain('"key"');
    expect(result).toContain('"value"');
  });

  it('truncates long JSON output', () => {
    const obj = { longKey: 'a'.repeat(600) };
    const result = formatJson(obj, 100);
    expect(result.length).toBe(100);
    expect(result.endsWith('...')).toBe(true);
  });

  it('does not truncate short JSON', () => {
    const obj = { a: 1 };
    const result = formatJson(obj, 500);
    expect(result.endsWith('...')).toBe(false);
  });
});

describe('getUrgencyEmoji', () => {
  it('returns red circle for critical', () => {
    expect(getUrgencyEmoji('critical')).toBe('🔴');
  });

  it('returns orange circle for high', () => {
    expect(getUrgencyEmoji('high')).toBe('🟠');
  });

  it('returns yellow circle for normal', () => {
    expect(getUrgencyEmoji('normal')).toBe('🟡');
  });

  it('returns green circle for low', () => {
    expect(getUrgencyEmoji('low')).toBe('🟢');
  });

  it('returns white circle for unknown urgency', () => {
    expect(getUrgencyEmoji('unknown')).toBe('⚪');
    expect(getUrgencyEmoji('')).toBe('⚪');
  });
});

describe('buildApprovalBlocks', () => {
  const baseRequest: ApprovalRequest = {
    id: 'req-123',
    action: 'delete_file',
    params: { path: '/tmp/test.txt' },
    urgency: 'high',
    status: 'pending',
    createdAt: '2024-01-15T10:00:00Z',
  };

  it('creates header block', () => {
    const blocks = buildApprovalBlocks(baseRequest);
    expect(blocks[0]).toEqual({
      type: 'header',
      text: {
        type: 'plain_text',
        text: '🔔 Approval Request',
        emoji: true,
      },
    });
  });

  it('includes action and urgency in section fields', () => {
    const blocks = buildApprovalBlocks(baseRequest);
    const section = blocks[1];
    expect(section.type).toBe('section');
    if (section.type === 'section' && section.fields) {
      const actionField = section.fields.find(
        (f) => 'text' in f && f.text.includes('delete_file')
      );
      expect(actionField).toBeDefined();
      
      const urgencyField = section.fields.find(
        (f) => 'text' in f && f.text.includes('🟠')
      );
      expect(urgencyField).toBeDefined();
    }
  });

  it('includes params section when params present', () => {
    const blocks = buildApprovalBlocks(baseRequest);
    const paramsBlock = blocks.find(
      (b) => b.type === 'section' && 'text' in b && b.text?.text?.includes('Parameters')
    );
    expect(paramsBlock).toBeDefined();
  });

  it('includes approve and deny buttons', () => {
    const blocks = buildApprovalBlocks(baseRequest);
    const actionsBlock = blocks.find((b) => b.type === 'actions');
    expect(actionsBlock).toBeDefined();
    
    if (actionsBlock && actionsBlock.type === 'actions') {
      expect(actionsBlock.elements).toHaveLength(2);
      expect(actionsBlock.elements[0]).toMatchObject({
        type: 'button',
        action_id: 'approve_req-123',
        style: 'primary',
      });
      expect(actionsBlock.elements[1]).toMatchObject({
        type: 'button',
        action_id: 'deny_req-123',
        style: 'danger',
      });
    }
  });

  it('handles Date object for createdAt', () => {
    const requestWithDate: ApprovalRequest = {
      ...baseRequest,
      createdAt: new Date('2024-01-15T10:00:00Z'),
    };
    const blocks = buildApprovalBlocks(requestWithDate);
    const section = blocks[1];
    if (section.type === 'section' && section.fields) {
      const createdField = section.fields.find(
        (f) => 'text' in f && f.text.includes('Created')
      );
      expect(createdField).toBeDefined();
      if (createdField && 'text' in createdField) {
        expect(createdField.text).toContain('2024-01-15');
      }
    }
  });

  it('skips params section when params empty', () => {
    const requestNoParams: ApprovalRequest = {
      ...baseRequest,
      params: {},
    };
    const blocks = buildApprovalBlocks(requestNoParams);
    const paramsBlock = blocks.find(
      (b) => b.type === 'section' && 'text' in b && b.text?.text?.includes('Parameters')
    );
    expect(paramsBlock).toBeUndefined();
  });

  it('includes context block when context present', () => {
    const requestWithContext: ApprovalRequest = {
      ...baseRequest,
      context: { user: 'agent-1', reason: 'cleanup' },
    };
    const blocks = buildApprovalBlocks(requestWithContext);
    const contextBlock = blocks.find((b) => b.type === 'context');
    expect(contextBlock).toBeDefined();
  });
});

describe('buildDecidedBlocks', () => {
  const baseRequest: ApprovalRequest = {
    id: 'req-456',
    action: 'send_email',
    params: { to: 'test@example.com' },
    urgency: 'normal',
    status: 'approved',
    createdAt: '2024-01-15T10:00:00Z',
  };

  it('creates approved header with checkmark', () => {
    const blocks = buildDecidedBlocks(baseRequest, 'approved', 'U123');
    expect(blocks[0]).toMatchObject({
      type: 'header',
      text: {
        type: 'plain_text',
        text: '✅ Request Approved',
      },
    });
  });

  it('creates denied header with X', () => {
    const blocks = buildDecidedBlocks(baseRequest, 'denied', 'U123');
    expect(blocks[0]).toMatchObject({
      type: 'header',
      text: {
        type: 'plain_text',
        text: '❌ Request Denied',
      },
    });
  });

  it('includes user mention in decision field', () => {
    const blocks = buildDecidedBlocks(baseRequest, 'approved', 'U456ABC');
    const section = blocks[1];
    if (section.type === 'section' && section.fields) {
      const decisionField = section.fields.find(
        (f) => 'text' in f && f.text.includes('<@U456ABC>')
      );
      expect(decisionField).toBeDefined();
    }
  });

  it('includes request ID in context', () => {
    const blocks = buildDecidedBlocks(baseRequest, 'denied', 'U123');
    const contextBlock = blocks.find((b) => b.type === 'context');
    expect(contextBlock).toBeDefined();
    if (contextBlock && contextBlock.type === 'context') {
      const element = contextBlock.elements[0];
      if ('text' in element) {
        expect(element.text).toContain('req-456');
      }
    }
  });
});
