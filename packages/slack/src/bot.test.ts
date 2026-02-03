import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ApprovalRequest } from '@agentgate/core';

// Mock @slack/bolt before importing bot
const mockStart = vi.fn();
const mockStop = vi.fn();
const mockAction = vi.fn();
const mockPostMessage = vi.fn();
const mockChatUpdate = vi.fn();
const mockPostEphemeral = vi.fn();

vi.mock('@slack/bolt', () => ({
  App: vi.fn().mockImplementation(() => ({
    start: mockStart,
    stop: mockStop,
    action: mockAction,
    client: {
      chat: {
        postMessage: mockPostMessage,
        update: mockChatUpdate,
        postEphemeral: mockPostEphemeral,
      },
    },
  })),
}));

// Import after mock
import { createSlackBot, type SlackBotOptions } from './bot.js';
import { App } from '@slack/bolt';

describe('createSlackBot', () => {
  const baseOptions: SlackBotOptions = {
    token: 'xoxb-test-token',
    signingSecret: 'test-signing-secret',
    agentgateUrl: 'http://localhost:3000',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('creates an App with token and signingSecret', () => {
      createSlackBot(baseOptions);
      
      expect(App).toHaveBeenCalledWith({
        token: 'xoxb-test-token',
        signingSecret: 'test-signing-secret',
      });
    });

    it('returns an object with app, sendApprovalRequest, start, and stop', () => {
      const bot = createSlackBot(baseOptions);
      
      expect(bot).toHaveProperty('app');
      expect(bot).toHaveProperty('sendApprovalRequest');
      expect(bot).toHaveProperty('start');
      expect(bot).toHaveProperty('stop');
    });

    it('registers approve action handler', () => {
      createSlackBot(baseOptions);
      
      const approveCall = mockAction.mock.calls.find(
        call => call[0] instanceof RegExp && call[0].source === '^approve_'
      );
      expect(approveCall).toBeDefined();
    });

    it('registers deny action handler', () => {
      createSlackBot(baseOptions);
      
      const denyCall = mockAction.mock.calls.find(
        call => call[0] instanceof RegExp && call[0].source === '^deny_'
      );
      expect(denyCall).toBeDefined();
    });

    it('accepts optional apiKey', () => {
      const optionsWithApiKey: SlackBotOptions = {
        ...baseOptions,
        apiKey: 'my-api-key',
      };
      
      const bot = createSlackBot(optionsWithApiKey);
      expect(bot).toBeDefined();
    });

    it('accepts optional defaultChannel', () => {
      const optionsWithChannel: SlackBotOptions = {
        ...baseOptions,
        defaultChannel: '#approvals',
      };
      
      const bot = createSlackBot(optionsWithChannel);
      expect(bot).toBeDefined();
    });

    it('accepts optional port', () => {
      const optionsWithPort: SlackBotOptions = {
        ...baseOptions,
        port: 4000,
      };
      
      const bot = createSlackBot(optionsWithPort);
      expect(bot).toBeDefined();
    });
  });

  describe('start', () => {
    it('calls app.start with default port 3001', async () => {
      const bot = createSlackBot(baseOptions);
      mockStart.mockResolvedValue(undefined);
      
      await bot.start();
      
      expect(mockStart).toHaveBeenCalledWith(3001);
    });

    it('calls app.start with custom port', async () => {
      const bot = createSlackBot({ ...baseOptions, port: 5000 });
      mockStart.mockResolvedValue(undefined);
      
      await bot.start();
      
      expect(mockStart).toHaveBeenCalledWith(5000);
    });

    it('logs startup message', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const bot = createSlackBot(baseOptions);
      mockStart.mockResolvedValue(undefined);
      
      await bot.start();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Slack bot is running on port 3001')
      );
      consoleSpy.mockRestore();
    });
  });

  describe('stop', () => {
    it('calls app.stop', async () => {
      const bot = createSlackBot(baseOptions);
      mockStop.mockResolvedValue(undefined);
      
      await bot.stop();
      
      expect(mockStop).toHaveBeenCalled();
    });

    it('logs stop message', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const bot = createSlackBot(baseOptions);
      mockStop.mockResolvedValue(undefined);
      
      await bot.stop();
      
      expect(consoleSpy).toHaveBeenCalledWith('Slack bot stopped');
      consoleSpy.mockRestore();
    });
  });

  describe('sendApprovalRequest', () => {
    const sampleRequest: ApprovalRequest = {
      id: 'req-123',
      action: 'delete_file',
      params: { path: '/tmp/test.txt' },
      urgency: 'high',
      status: 'pending',
      createdAt: '2024-01-15T10:00:00Z',
    };

    it('posts message to specified channel', async () => {
      const bot = createSlackBot(baseOptions);
      mockPostMessage.mockResolvedValue({ ts: '1234567890.123456' });
      
      await bot.sendApprovalRequest(sampleRequest, '#approvals');
      
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: '#approvals',
        })
      );
    });

    it('includes approval blocks in message', async () => {
      const bot = createSlackBot(baseOptions);
      mockPostMessage.mockResolvedValue({ ts: '1234567890.123456' });
      
      await bot.sendApprovalRequest(sampleRequest, '#approvals');
      
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.any(Array),
        })
      );
    });

    it('includes fallback text in message', async () => {
      const bot = createSlackBot(baseOptions);
      mockPostMessage.mockResolvedValue({ ts: '1234567890.123456' });
      
      await bot.sendApprovalRequest(sampleRequest, '#approvals');
      
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('delete_file'),
        })
      );
    });

    it('returns message timestamp', async () => {
      const bot = createSlackBot(baseOptions);
      mockPostMessage.mockResolvedValue({ ts: '1234567890.123456' });
      
      const ts = await bot.sendApprovalRequest(sampleRequest, '#approvals');
      
      expect(ts).toBe('1234567890.123456');
    });

    it('throws error when no timestamp returned', async () => {
      const bot = createSlackBot(baseOptions);
      mockPostMessage.mockResolvedValue({});
      
      await expect(
        bot.sendApprovalRequest(sampleRequest, '#approvals')
      ).rejects.toThrow('Failed to send message: no timestamp returned');
    });

    it('includes urgency in text', async () => {
      const bot = createSlackBot(baseOptions);
      mockPostMessage.mockResolvedValue({ ts: '1234567890.123456' });
      
      await bot.sendApprovalRequest(sampleRequest, '#general');
      
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('high'),
        })
      );
    });
  });
});

describe('action handlers', () => {
  const baseOptions: SlackBotOptions = {
    token: 'xoxb-test-token',
    signingSecret: 'test-signing-secret',
    agentgateUrl: 'http://localhost:3000',
  };

  let approveHandler: Function;
  let denyHandler: Function;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create bot to register handlers
    createSlackBot(baseOptions);
    
    // Extract the registered handlers
    approveHandler = mockAction.mock.calls.find(
      call => call[0] instanceof RegExp && call[0].source === '^approve_'
    )?.[1];
    
    denyHandler = mockAction.mock.calls.find(
      call => call[0] instanceof RegExp && call[0].source === '^deny_'
    )?.[1];

    // Mock fetch
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('approve handler', () => {
    const mockAck = vi.fn();
    const mockLogger = { error: vi.fn() };

    it('calls ack immediately', async () => {
      const context = {
        action: { value: 'req-123' },
        ack: mockAck,
        body: { user: { id: 'U123' }, channel: { id: 'C123' }, message: { ts: '123.456' } },
        client: { chat: { update: mockChatUpdate, postEphemeral: mockPostEphemeral } },
        logger: mockLogger,
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'req-123', status: 'approved' }),
      });

      await approveHandler(context);

      expect(mockAck).toHaveBeenCalled();
    });

    it('calls AgentGate API with correct URL', async () => {
      const context = {
        action: { value: 'req-456' },
        ack: mockAck,
        body: { user: { id: 'U123' }, channel: { id: 'C123' }, message: { ts: '123.456' } },
        client: { chat: { update: mockChatUpdate, postEphemeral: mockPostEphemeral } },
        logger: mockLogger,
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'req-456', status: 'approved' }),
      });

      await approveHandler(context);

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/api/requests/req-456/decide',
        expect.any(Object)
      );
    });

    it('sends approved decision in body', async () => {
      const context = {
        action: { value: 'req-123' },
        ack: mockAck,
        body: { user: { id: 'U789' }, channel: { id: 'C123' }, message: { ts: '123.456' } },
        client: { chat: { update: mockChatUpdate, postEphemeral: mockPostEphemeral } },
        logger: mockLogger,
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'req-123', status: 'approved' }),
      });

      await approveHandler(context);

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            decision: 'approved',
            decidedBy: 'slack:U789',
          }),
        })
      );
    });

    it('updates original message on success', async () => {
      const context = {
        action: { value: 'req-123' },
        ack: mockAck,
        body: { user: { id: 'U123' }, channel: { id: 'C456' }, message: { ts: '111.222' } },
        client: { chat: { update: mockChatUpdate, postEphemeral: mockPostEphemeral } },
        logger: mockLogger,
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'req-123', action: 'test', status: 'approved' }),
      });

      await approveHandler(context);

      expect(mockChatUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C456',
          ts: '111.222',
        })
      );
    });

    it('returns early when action missing value', async () => {
      const context = {
        action: {},
        ack: mockAck,
        body: { user: { id: 'U123' } },
        client: { chat: { update: mockChatUpdate, postEphemeral: mockPostEphemeral } },
        logger: mockLogger,
      };

      await approveHandler(context);

      expect(mockAck).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith('Action missing value');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('logs and sends ephemeral error on API failure', async () => {
      const context = {
        action: { value: 'req-123' },
        ack: mockAck,
        body: { user: { id: 'U123' }, channel: { id: 'C123' } },
        client: { chat: { update: mockChatUpdate, postEphemeral: mockPostEphemeral } },
        logger: mockLogger,
      };

      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not found'),
      });

      await approveHandler(context);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to approve request:',
        expect.any(Error)
      );
      expect(mockPostEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C123',
          user: 'U123',
          text: expect.stringContaining('Failed to approve request'),
        })
      );
    });

    it('handles non-Error exceptions', async () => {
      const context = {
        action: { value: 'req-123' },
        ack: mockAck,
        body: { user: { id: 'U123' }, channel: { id: 'C123' } },
        client: { chat: { update: mockChatUpdate, postEphemeral: mockPostEphemeral } },
        logger: mockLogger,
      };

      fetchMock.mockRejectedValue('string error');

      await approveHandler(context);

      expect(mockPostEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Unknown error'),
        })
      );
    });

    it('does not update message when channel id missing', async () => {
      const context = {
        action: { value: 'req-123' },
        ack: mockAck,
        body: { user: { id: 'U123' }, message: { ts: '123.456' } },
        client: { chat: { update: mockChatUpdate, postEphemeral: mockPostEphemeral } },
        logger: mockLogger,
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'req-123', status: 'approved' }),
      });

      await approveHandler(context);

      expect(mockChatUpdate).not.toHaveBeenCalled();
    });

    it('does not update message when message ts missing', async () => {
      const context = {
        action: { value: 'req-123' },
        ack: mockAck,
        body: { user: { id: 'U123' }, channel: { id: 'C123' } },
        client: { chat: { update: mockChatUpdate, postEphemeral: mockPostEphemeral } },
        logger: mockLogger,
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'req-123', status: 'approved' }),
      });

      await approveHandler(context);

      expect(mockChatUpdate).not.toHaveBeenCalled();
    });
  });

  describe('deny handler', () => {
    const mockAck = vi.fn();
    const mockLogger = { error: vi.fn() };

    it('calls ack immediately', async () => {
      const context = {
        action: { value: 'req-123' },
        ack: mockAck,
        body: { user: { id: 'U123' }, channel: { id: 'C123' }, message: { ts: '123.456' } },
        client: { chat: { update: mockChatUpdate, postEphemeral: mockPostEphemeral } },
        logger: mockLogger,
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'req-123', status: 'denied' }),
      });

      await denyHandler(context);

      expect(mockAck).toHaveBeenCalled();
    });

    it('sends denied decision in body', async () => {
      const context = {
        action: { value: 'req-789' },
        ack: mockAck,
        body: { user: { id: 'UABC' }, channel: { id: 'C123' }, message: { ts: '123.456' } },
        client: { chat: { update: mockChatUpdate, postEphemeral: mockPostEphemeral } },
        logger: mockLogger,
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'req-789', status: 'denied' }),
      });

      await denyHandler(context);

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            decision: 'denied',
            decidedBy: 'slack:UABC',
          }),
        })
      );
    });

    it('updates message with denied status', async () => {
      const context = {
        action: { value: 'req-123' },
        ack: mockAck,
        body: { user: { id: 'U123' }, channel: { id: 'C456' }, message: { ts: '111.222' } },
        client: { chat: { update: mockChatUpdate, postEphemeral: mockPostEphemeral } },
        logger: mockLogger,
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'req-123', action: 'test', status: 'denied' }),
      });

      await denyHandler(context);

      expect(mockChatUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('denied'),
        })
      );
    });

    it('returns early when action missing value', async () => {
      const context = {
        action: {},
        ack: mockAck,
        body: { user: { id: 'U123' } },
        client: { chat: { update: mockChatUpdate, postEphemeral: mockPostEphemeral } },
        logger: mockLogger,
      };

      await denyHandler(context);

      expect(mockAck).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith('Action missing value');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('logs error on API failure', async () => {
      const context = {
        action: { value: 'req-123' },
        ack: mockAck,
        body: { user: { id: 'U123' }, channel: { id: 'C123' } },
        client: { chat: { update: mockChatUpdate, postEphemeral: mockPostEphemeral } },
        logger: mockLogger,
      };

      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error'),
      });

      await denyHandler(context);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to deny request:',
        expect.any(Error)
      );
    });

    it('sends ephemeral error message on failure', async () => {
      const context = {
        action: { value: 'req-123' },
        ack: mockAck,
        body: { user: { id: 'U999' }, channel: { id: 'CXYZ' } },
        client: { chat: { update: mockChatUpdate, postEphemeral: mockPostEphemeral } },
        logger: mockLogger,
      };

      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad request'),
      });

      await denyHandler(context);

      expect(mockPostEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'CXYZ',
          user: 'U999',
          text: expect.stringContaining('Failed to deny request'),
        })
      );
    });

    it('does not send ephemeral when channel missing on error', async () => {
      const context = {
        action: { value: 'req-123' },
        ack: mockAck,
        body: { user: { id: 'U123' } },
        client: { chat: { update: mockChatUpdate, postEphemeral: mockPostEphemeral } },
        logger: mockLogger,
      };

      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Error'),
      });

      await denyHandler(context);

      expect(mockPostEphemeral).not.toHaveBeenCalled();
    });
  });
});

describe('API key header inclusion', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let approveHandler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includes Authorization header when apiKey provided', async () => {
    const optionsWithKey: SlackBotOptions = {
      token: 'xoxb-test',
      signingSecret: 'secret',
      agentgateUrl: 'http://localhost:3000',
      apiKey: 'my-secret-api-key',
    };
    
    createSlackBot(optionsWithKey);
    
    approveHandler = mockAction.mock.calls.find(
      call => call[0] instanceof RegExp && call[0].source === '^approve_'
    )?.[1];

    const context = {
      action: { value: 'req-123' },
      ack: vi.fn(),
      body: { user: { id: 'U123' }, channel: { id: 'C123' }, message: { ts: '123.456' } },
      client: { chat: { update: mockChatUpdate, postEphemeral: mockPostEphemeral } },
      logger: { error: vi.fn() },
    };

    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'req-123', status: 'approved' }),
    });

    await approveHandler(context);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer my-secret-api-key',
        }),
      })
    );
  });

  it('omits Authorization header when apiKey not provided', async () => {
    const optionsNoKey: SlackBotOptions = {
      token: 'xoxb-test',
      signingSecret: 'secret',
      agentgateUrl: 'http://localhost:3000',
    };
    
    createSlackBot(optionsNoKey);
    
    approveHandler = mockAction.mock.calls.find(
      call => call[0] instanceof RegExp && call[0].source === '^approve_'
    )?.[1];

    const context = {
      action: { value: 'req-123' },
      ack: vi.fn(),
      body: { user: { id: 'U123' }, channel: { id: 'C123' }, message: { ts: '123.456' } },
      client: { chat: { update: mockChatUpdate, postEphemeral: mockPostEphemeral } },
      logger: { error: vi.fn() },
    };

    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'req-123', status: 'approved' }),
    });

    await approveHandler(context);

    const callHeaders = fetchMock.mock.calls[0][1].headers;
    expect(callHeaders).not.toHaveProperty('Authorization');
  });

  it('always includes Content-Type header', async () => {
    const options: SlackBotOptions = {
      token: 'xoxb-test',
      signingSecret: 'secret',
      agentgateUrl: 'http://localhost:3000',
    };
    
    createSlackBot(options);
    
    approveHandler = mockAction.mock.calls.find(
      call => call[0] instanceof RegExp && call[0].source === '^approve_'
    )?.[1];

    const context = {
      action: { value: 'req-123' },
      ack: vi.fn(),
      body: { user: { id: 'U123' }, channel: { id: 'C123' }, message: { ts: '123.456' } },
      client: { chat: { update: mockChatUpdate, postEphemeral: mockPostEphemeral } },
      logger: { error: vi.fn() },
    };

    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'req-123', status: 'approved' }),
    });

    await approveHandler(context);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    );
  });
});
