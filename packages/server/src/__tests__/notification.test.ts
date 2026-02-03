import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationDispatcher,
  createDispatcher,
  getGlobalDispatcher,
  resetGlobalDispatcher,
  type NotificationChannelAdapter,
} from "../lib/notification/index.js";
import {
  EventNames,
  type RequestCreatedEvent,
  type RequestDecidedEvent,
} from "@agentgate/core";
import { setConfig, resetConfig, type Config } from "../config.js";

// Mock config for tests
const mockConfig: Config = {
  port: 3000,
  host: "0.0.0.0",
  nodeEnv: "test",
  databaseUrl: ":memory:",
  corsOrigins: "*",
  rateLimitRpm: 60,
  rateLimitEnabled: false,
  requestTimeoutSec: 3600,
  webhookTimeoutMs: 5000,
  webhookMaxRetries: 3,
  channelRoutes: [],
  logLevel: "error",
  logFormat: "json",
};

describe("NotificationDispatcher", () => {
  let dispatcher: NotificationDispatcher;

  beforeEach(() => {
    setConfig({ ...mockConfig });
    dispatcher = createDispatcher();
  });

  afterEach(() => {
    resetConfig();
    resetGlobalDispatcher();
  });

  describe("adapter registration", () => {
    it("should have default adapters registered", () => {
      expect(dispatcher.getAdapter("email")).toBeDefined();
      expect(dispatcher.getAdapter("slack")).toBeDefined();
      expect(dispatcher.getAdapter("discord")).toBeDefined();
      expect(dispatcher.getAdapter("webhook")).toBeDefined();
    });

    it("should allow registering custom adapters", async () => {
      const customAdapter: NotificationChannelAdapter = {
        type: "webhook",
        isConfigured: () => true,
        send: vi.fn().mockResolvedValue({
          success: true,
          channel: "webhook",
          target: "test",
          timestamp: Date.now(),
        }),
      };

      dispatcher.registerAdapter(customAdapter);
      expect(dispatcher.getAdapter("webhook")).toBe(customAdapter);
    });
  });

  describe("route matching", () => {
    it("should match routes by event type", () => {
      setConfig({
        ...mockConfig,
        channelRoutes: [
          {
            channel: "webhook",
            target: "https://example.com/hook1",
            eventTypes: ["request.created"],
            enabled: true,
          },
          {
            channel: "webhook",
            target: "https://example.com/hook2",
            eventTypes: ["request.decided"],
            enabled: true,
          },
        ],
      });

      dispatcher = createDispatcher();

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "send_email",
          params: {},
          context: {},
          urgency: "normal",
        },
      };

      const routes = dispatcher.matchRoutes(event);
      expect(routes).toHaveLength(1);
      expect(routes[0]?.target).toBe("https://example.com/hook1");
    });

    it("should match routes by action", () => {
      setConfig({
        ...mockConfig,
        channelRoutes: [
          {
            channel: "webhook",
            target: "https://example.com/hook1",
            actions: ["send_email"],
            enabled: true,
          },
          {
            channel: "webhook",
            target: "https://example.com/hook2",
            actions: ["transfer_funds"],
            enabled: true,
          },
        ],
      });

      dispatcher = createDispatcher();

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "send_email",
          params: {},
          context: {},
          urgency: "normal",
        },
      };

      const routes = dispatcher.matchRoutes(event);
      expect(routes).toHaveLength(1);
      expect(routes[0]?.target).toBe("https://example.com/hook1");
    });

    it("should match routes by urgency", () => {
      setConfig({
        ...mockConfig,
        channelRoutes: [
          {
            channel: "webhook",
            target: "https://example.com/urgent",
            urgencies: ["high", "critical"],
            enabled: true,
          },
          {
            channel: "webhook",
            target: "https://example.com/normal",
            urgencies: ["low", "normal"],
            enabled: true,
          },
        ],
      });

      dispatcher = createDispatcher();

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "send_email",
          params: {},
          context: {},
          urgency: "critical",
        },
      };

      const routes = dispatcher.matchRoutes(event);
      expect(routes).toHaveLength(1);
      expect(routes[0]?.target).toBe("https://example.com/urgent");
    });

    it("should skip disabled routes", () => {
      setConfig({
        ...mockConfig,
        channelRoutes: [
          {
            channel: "webhook",
            target: "https://example.com/enabled",
            enabled: true,
          },
          {
            channel: "webhook",
            target: "https://example.com/disabled",
            enabled: false,
          },
        ],
      });

      dispatcher = createDispatcher();

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "send_email",
          params: {},
          context: {},
          urgency: "normal",
        },
      };

      const routes = dispatcher.matchRoutes(event);
      expect(routes).toHaveLength(1);
      expect(routes[0]?.target).toBe("https://example.com/enabled");
    });

    it("should parse policy channels", () => {
      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "send_email",
          params: {},
          context: {},
          urgency: "normal",
        },
      };

      const routes = dispatcher.matchRoutes(event, [
        "slack:#alerts",
        "email:admin@example.com",
      ]);

      expect(routes).toHaveLength(2);
      expect(routes[0]?.channel).toBe("slack");
      expect(routes[0]?.target).toBe("#alerts");
      expect(routes[1]?.channel).toBe("email");
      expect(routes[1]?.target).toBe("admin@example.com");
    });

    it("should use default channels when no routes match", () => {
      setConfig({
        ...mockConfig,
        slackBotToken: "xoxb-test",
        slackDefaultChannel: "#general",
      });

      dispatcher = createDispatcher();

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "send_email",
          params: {},
          context: {},
          urgency: "normal",
        },
      };

      const routes = dispatcher.matchRoutes(event);
      expect(routes).toHaveLength(1);
      expect(routes[0]?.channel).toBe("slack");
      expect(routes[0]?.target).toBe("#general");
    });

    it("should deduplicate routes by channel+target", () => {
      setConfig({
        ...mockConfig,
        channelRoutes: [
          {
            channel: "webhook",
            target: "https://example.com/hook",
            enabled: true,
          },
        ],
      });

      dispatcher = createDispatcher();

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "send_email",
          params: {},
          context: {},
          urgency: "normal",
        },
      };

      // Include duplicate via policy channels
      const routes = dispatcher.matchRoutes(event, [
        "webhook:https://example.com/hook",
      ]);

      expect(routes).toHaveLength(1);
    });
  });

  describe("dispatch", () => {
    it("should dispatch to matched routes", async () => {
      const mockSend = vi.fn().mockResolvedValue({
        success: true,
        channel: "webhook",
        target: "https://example.com/hook",
        timestamp: Date.now(),
      });

      const mockAdapter: NotificationChannelAdapter = {
        type: "webhook",
        isConfigured: () => true,
        send: mockSend,
      };

      dispatcher.registerAdapter(mockAdapter);

      setConfig({
        ...mockConfig,
        channelRoutes: [
          {
            channel: "webhook",
            target: "https://example.com/hook",
            enabled: true,
          },
        ],
      });

      // Re-create dispatcher to pick up new config
      dispatcher = createDispatcher();
      dispatcher.registerAdapter(mockAdapter);

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "send_email",
          params: {},
          context: {},
          urgency: "normal",
        },
      };

      const results = await dispatcher.dispatch(event);

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith("https://example.com/hook", event);
      expect(results).toHaveLength(1);
      expect(results[0]?.success).toBe(true);
    });

    it("should handle adapter errors gracefully", async () => {
      const mockAdapter: NotificationChannelAdapter = {
        type: "webhook",
        isConfigured: () => true,
        send: vi.fn().mockRejectedValue(new Error("Network error")),
      };

      dispatcher.registerAdapter(mockAdapter);

      setConfig({
        ...mockConfig,
        channelRoutes: [
          {
            channel: "webhook",
            target: "https://example.com/hook",
            enabled: true,
          },
        ],
      });

      dispatcher = createDispatcher({ failSilently: true });
      dispatcher.registerAdapter(mockAdapter);

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "send_email",
          params: {},
          context: {},
          urgency: "normal",
        },
      };

      const results = await dispatcher.dispatch(event);

      expect(results).toHaveLength(1);
      expect(results[0]?.success).toBe(false);
      expect(results[0]?.error).toBe("Network error");
    });

    it("should return error for unknown channel type", async () => {
      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "send_email",
          params: {},
          context: {},
          urgency: "normal",
        },
      };

      // Force an unknown channel type through policy channels
      // @ts-expect-error - testing invalid channel type
      const routes = dispatcher.matchRoutes(event, ["invalid:target"]);
      
      // Should be empty since invalid type is not registered
      expect(routes).toHaveLength(0);
    });
  });

  describe("global dispatcher", () => {
    it("should return same instance on multiple calls", () => {
      const d1 = getGlobalDispatcher();
      const d2 = getGlobalDispatcher();
      expect(d1).toBe(d2);
    });

    it("should return new instance after reset", () => {
      const d1 = getGlobalDispatcher();
      resetGlobalDispatcher();
      const d2 = getGlobalDispatcher();
      expect(d1).not.toBe(d2);
    });
  });
});

describe("Notification Adapters", () => {
  beforeEach(() => {
    setConfig({ ...mockConfig });
  });

  afterEach(() => {
    resetConfig();
  });

  describe("EmailAdapter", () => {
    it("should report not configured when SMTP is missing", async () => {
      const { EmailAdapter } = await import("../lib/notification/adapters/email.js");
      const adapter = new EmailAdapter();
      expect(adapter.isConfigured()).toBe(false);
    });

    it("should format email subject correctly", async () => {
      const { formatEmailSubject } = await import("../lib/notification/adapters/email.js");

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "send_email",
          params: {},
          context: {},
          urgency: "normal",
        },
      };

      const subject = formatEmailSubject(event);
      expect(subject).toContain("[AgentGate]");
      expect(subject).toContain("send_email");
    });
  });

  describe("SlackAdapter", () => {
    it("should report not configured when token is missing", async () => {
      const { SlackAdapter } = await import("../lib/notification/adapters/slack.js");
      const adapter = new SlackAdapter();
      expect(adapter.isConfigured()).toBe(false);
    });

    it("should build request created blocks", async () => {
      const { buildSlackBlocks } = await import("../lib/notification/adapters/slack.js");

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "send_email",
          params: { to: "user@example.com" },
          context: {},
          urgency: "high",
        },
      };

      const blocks = buildSlackBlocks(event);
      expect(blocks).toBeInstanceOf(Array);
      expect(blocks.length).toBeGreaterThan(0);
      
      // Should have header block
      const header = blocks[0] as { type: string; text: { text: string } };
      expect(header.type).toBe("header");
      expect(header.text.text).toContain("Approval Request");
    });

    it("should build request decided blocks", async () => {
      const { buildSlackBlocks } = await import("../lib/notification/adapters/slack.js");

      const event: RequestDecidedEvent = {
        type: EventNames.REQUEST_DECIDED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "send_email",
          status: "approved",
          decidedBy: "user_1",
          decidedByType: "human",
          decisionTimeMs: 5000,
        },
      };

      const blocks = buildSlackBlocks(event);
      expect(blocks).toBeInstanceOf(Array);
      
      const header = blocks[0] as { type: string; text: { text: string } };
      expect(header.type).toBe("header");
      expect(header.text.text).toContain("Approved");
    });
  });

  describe("DiscordAdapter", () => {
    it("should report not configured when token is missing", async () => {
      const { DiscordAdapter } = await import("../lib/notification/adapters/discord.js");
      const adapter = new DiscordAdapter();
      expect(adapter.isConfigured()).toBe(false);
    });

    it("should build request created embed", async () => {
      const { buildDiscordEmbed } = await import("../lib/notification/adapters/discord.js");

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "send_email",
          params: {},
          context: {},
          urgency: "critical",
        },
      };

      const embed = buildDiscordEmbed(event) as {
        title: string;
        color: number;
        fields: Array<{ name: string; value: string }>;
      };

      expect(embed.title).toContain("Approval Request");
      expect(embed.color).toBe(0xef4444); // Critical red
      expect(embed.fields).toBeInstanceOf(Array);
    });

    it("should get correct color for urgency", async () => {
      const { getEventColor } = await import("../lib/notification/adapters/discord.js");

      const lowEvent: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "test",
          params: {},
          context: {},
          urgency: "low",
        },
      };

      const criticalEvent: RequestCreatedEvent = {
        ...lowEvent,
        payload: { ...lowEvent.payload, urgency: "critical" },
      };

      expect(getEventColor(lowEvent)).toBe(0x22c55e); // Green
      expect(getEventColor(criticalEvent)).toBe(0xef4444); // Red
    });
  });

  describe("WebhookAdapter", () => {
    it("should always report configured", async () => {
      const { WebhookAdapter } = await import("../lib/notification/adapters/webhook.js");
      const adapter = new WebhookAdapter();
      expect(adapter.isConfigured()).toBe(true);
    });

    it("should fail for invalid URL", async () => {
      const { WebhookAdapter } = await import("../lib/notification/adapters/webhook.js");
      const adapter = new WebhookAdapter();

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "test",
          params: {},
          context: {},
          urgency: "normal",
        },
      };

      const result = await adapter.send("not-a-valid-url", event);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid webhook URL");
    });

    it("should build correct payload structure", async () => {
      const { buildWebhookPayload } = await import("../lib/notification/adapters/webhook.js");

      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: 1234567890,
        eventId: "evt_1",
        source: "test",
        payload: {
          requestId: "req_1",
          action: "send_email",
          params: { to: "user@example.com" },
          context: {},
          urgency: "normal",
        },
      };

      const payload = buildWebhookPayload(event) as {
        event: string;
        timestamp: number;
        eventId: string;
        data: object;
      };

      expect(payload.event).toBe("request.created");
      expect(payload.timestamp).toBe(1234567890);
      expect(payload.eventId).toBe("evt_1");
      expect(payload.data).toEqual(event.payload);
    });

    it("should sign payload with secret", async () => {
      const { signPayload } = await import("../lib/notification/adapters/webhook.js");

      const payload = '{"test":"data"}';
      const secret = "test-secret";
      const signature = signPayload(payload, secret);

      // Should be a hex string
      expect(signature).toMatch(/^[a-f0-9]+$/);
      // SHA256 produces 64 hex chars
      expect(signature).toHaveLength(64);
      // Same input should produce same signature
      expect(signPayload(payload, secret)).toBe(signature);
      // Different secret should produce different signature
      expect(signPayload(payload, "different-secret")).not.toBe(signature);
    });
  });
});
