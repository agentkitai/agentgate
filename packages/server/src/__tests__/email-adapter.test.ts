import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing
vi.mock('../config.js', () => ({
  getConfig: vi.fn(() => ({
    smtpHost: 'smtp.test.com',
    smtpPort: 587,
    smtpFrom: 'test@test.com',
    smtpUser: 'user',
    smtpPass: 'pass',
  })),
}));

vi.mock('../../lib/decision-tokens.js', () => ({
  generateDecisionTokens: vi.fn().mockResolvedValue(null),
}));

const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'msg-1' });
const mockCreateTransport = vi.fn(() => ({ sendMail: mockSendMail }));

vi.mock('nodemailer', () => ({
  default: { createTransport: (...args: unknown[]) => mockCreateTransport(...args) },
  createTransport: (...args: unknown[]) => mockCreateTransport(...args),
}));

import { EmailAdapter } from '../lib/notification/adapters/email.js';
import type { AgentGateEvent } from '@agentkitai/agentgate-core';

const testEvent: AgentGateEvent = {
  eventId: 'evt-1',
  type: 'request.expired',
  timestamp: Date.now(),
  source: 'test',
  payload: { requestId: 'req-1', action: 'test.action', urgency: 'normal' },
} as unknown as AgentGateEvent;

describe('EmailAdapter transporter reuse', () => {
  beforeEach(() => {
    mockCreateTransport.mockClear();
    mockSendMail.mockClear();
  });

  it('creates transporter only once across multiple send() calls', async () => {
    const adapter = new EmailAdapter();

    await adapter.send('a@test.com', testEvent);
    await adapter.send('b@test.com', testEvent);
    await adapter.send('c@test.com', testEvent);

    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledTimes(3);
  });

  it('invalidates transporter on connection error and recreates on next call', async () => {
    const adapter = new EmailAdapter();

    // First call succeeds
    await adapter.send('a@test.com', testEvent);
    expect(mockCreateTransport).toHaveBeenCalledTimes(1);

    // Second call fails with connection error
    const connError = new Error('connect ECONNREFUSED');
    (connError as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    mockSendMail.mockRejectedValueOnce(connError);

    const result = await adapter.send('b@test.com', testEvent);
    expect(result.success).toBe(false);

    // Third call should create a new transporter
    mockSendMail.mockResolvedValueOnce({ messageId: 'msg-2' });
    await adapter.send('c@test.com', testEvent);
    expect(mockCreateTransport).toHaveBeenCalledTimes(2);
  });
});
