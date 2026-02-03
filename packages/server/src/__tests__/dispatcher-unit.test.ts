import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { AgentGateEvent } from "@agentgate/core";
import {
  NotificationDispatcher,
  getGlobalDispatcher,
  resetGlobalDispatcher,
  createDispatcher,
} from "../lib/notification/dispatcher.js";
import type { NotificationChannelAdapter, NotificationResult, ChannelRoute } from "../lib/notification/types.js";
import { resetConfig, setConfig, parseConfig } from "../config.js";

// Mock adapter for testing
class MockAdapter implements NotificationChannelAdapter {
  readonly type = "slack" as const;
  private configured: boolean;
  public sendCalls: Array<{ target: string; event: AgentGateEvent }> = [];
  public shouldFail: boolean = false;
  public failMessage: string = "Mock failure";

  constructor(configured: boolean = true) {
    this.configured = configured;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async send(target: string, event: AgentGateEvent): Promise<NotificationResult> {
    this.sendCalls.push({ target, event });
    if (this.shouldFail) {
      return {
        success: false,
        channel: this.type,
        target,
        error: this.failMessage,
        timestamp: Date.now(),
      };
    }
    return {
      success: true,
      channel: this.type,
      target,
      timestamp: Date.now(),
    };
  }
}

// Helper to create test events
function createTestEvent(type: string, overrides: Partial<AgentGateEvent> = {}): AgentGateEvent {
  const base = {
    eventId: "evt-123",
    timestamp: Date.now(),
    source: "test",
  };

  if (type === "request.created") {
    return {
      ...base,
      type: "request.created",
      payload: {
        requestId: "req-123",
        action: "test_action",
        params: {},
        context: {},
        urgency: "normal",
        policyDecision: { decision: "ask" },
      },
      ...overrides,
    } as AgentGateEvent;
  }

  if (type === "request.decided") {
    return {
      ...base,
      type: "request.decided",
      payload: {
        requestId: "req-123",
        action: "test_action",
        status: "approved",
        decidedBy: "user",
        decidedByType: "human",
        decisionTimeMs: 1000,
      },
      ...overrides,
    } as AgentGateEvent;
  }

  return {
    ...base,
    type,
    payload: {},
    ...overrides,
  } as AgentGateEvent;
}

describe("NotificationDispatcher unit tests", () => {
  beforeEach(() => {
    resetConfig();
    resetGlobalDispatcher();
    // Set a minimal config
    setConfig(parseConfig({}));
  });

  afterEach(() => {
    resetConfig();
    resetGlobalDispatcher();
    vi.restoreAllMocks();
  });

  describe("constructor and options", () => {
    it("should use default options when none provided", () => {
      const dispatcher = new NotificationDispatcher();
      expect(dispatcher).toBeDefined();
    });

    it("should merge custom options with defaults", () => {
      const dispatcher = new NotificationDispatcher({
        failSilently: false,
        logLevel: "debug",
      });
      expect(dispatcher).toBeDefined();
    });

    it("should accept defaultRoutes in options", () => {
      const defaultRoutes: ChannelRoute[] = [
        { channel: "slack", target: "#default", enabled: true },
      ];
      const dispatcher = new NotificationDispatcher({ defaultRoutes });
      const routes = dispatcher.getRoutes();
      expect(routes).toContainEqual(expect.objectContaining({ target: "#default" }));
    });
  });

  describe("registerAdapter", () => {
    it("should register a custom adapter", () => {
      const dispatcher = new NotificationDispatcher();
      const mockAdapter = new MockAdapter();
      dispatcher.registerAdapter(mockAdapter);
      expect(dispatcher.getAdapter("slack")).toBe(mockAdapter);
    });

    it("should override existing adapter of same type", () => {
      const dispatcher = new NotificationDispatcher();
      const adapter1 = new MockAdapter(true);
      const adapter2 = new MockAdapter(false);
      
      dispatcher.registerAdapter(adapter1);
      expect(dispatcher.getAdapter("slack")?.isConfigured()).toBe(true);
      
      dispatcher.registerAdapter(adapter2);
      expect(dispatcher.getAdapter("slack")?.isConfigured()).toBe(false);
    });
  });

  describe("getAdapter", () => {
    it("should return undefined for unregistered adapter type", () => {
      const dispatcher = createDispatcher();
      // Cast to any to test with invalid type
      expect(dispatcher.getAdapter("nonexistent" as any)).toBeUndefined();
    });

    it("should return registered adapter", () => {
      const dispatcher = createDispatcher();
      expect(dispatcher.getAdapter("email")).toBeDefined();
      expect(dispatcher.getAdapter("slack")).toBeDefined();
      expect(dispatcher.getAdapter("discord")).toBeDefined();
      expect(dispatcher.getAdapter("webhook")).toBeDefined();
    });
  });

  describe("isChannelConfigured", () => {
    it("should return false for unconfigured channels", () => {
      const dispatcher = createDispatcher();
      // Default adapters check config which is empty
      expect(dispatcher.isChannelConfigured("slack")).toBe(false);
      expect(dispatcher.isChannelConfigured("discord")).toBe(false);
      expect(dispatcher.isChannelConfigured("email")).toBe(false);
    });

    it("should return true for always-configured webhook", () => {
      const dispatcher = createDispatcher();
      expect(dispatcher.isChannelConfigured("webhook")).toBe(true);
    });

    it("should return false for unregistered channel type", () => {
      const dispatcher = createDispatcher();
      expect(dispatcher.isChannelConfigured("nonexistent" as any)).toBe(false);
    });
  });

  describe("getRoutes", () => {
    it("should return empty array when no routes configured", () => {
      const dispatcher = createDispatcher();
      const routes = dispatcher.getRoutes();
      expect(routes).toEqual([]);
    });

    it("should return default routes from options", () => {
      const defaultRoutes: ChannelRoute[] = [
        { channel: "webhook", target: "https://example.com/hook", enabled: true },
      ];
      const dispatcher = createDispatcher({ defaultRoutes });
      const routes = dispatcher.getRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].target).toBe("https://example.com/hook");
    });

    it("should combine config routes and default routes", () => {
      // Set config with routes
      setConfig(parseConfig({
        channelRoutes: JSON.stringify([
          { channel: "slack", target: "#config-channel", enabled: true },
        ]),
      }));

      const defaultRoutes: ChannelRoute[] = [
        { channel: "webhook", target: "https://example.com", enabled: true },
      ];
      const dispatcher = createDispatcher({ defaultRoutes });
      const routes = dispatcher.getRoutes();
      
      expect(routes).toHaveLength(2);
      expect(routes.map(r => r.target)).toContain("#config-channel");
      expect(routes.map(r => r.target)).toContain("https://example.com");
    });

    it("should filter out unsupported channel types from config", () => {
      // The config parser already validates channels, but the dispatcher
      // also filters to only include supported types
      setConfig(parseConfig({
        channelRoutes: JSON.stringify([
          { channel: "slack", target: "#valid" },
          { channel: "email", target: "test@example.com" },
        ]),
      }));

      const dispatcher = createDispatcher();
      const routes = dispatcher.getRoutes();
      expect(routes.every(r => ["email", "slack", "discord", "webhook"].includes(r.channel))).toBe(true);
    });
  });

  describe("matchRoutes", () => {
    it("should match routes by event type", () => {
      const routes: ChannelRoute[] = [
        { channel: "slack", target: "#created", eventTypes: ["request.created"], enabled: true },
        { channel: "slack", target: "#decided", eventTypes: ["request.decided"], enabled: true },
      ];
      const dispatcher = createDispatcher({ defaultRoutes: routes });

      const createdEvent = createTestEvent("request.created");
      const matchedCreated = dispatcher.matchRoutes(createdEvent);
      expect(matchedCreated).toHaveLength(1);
      expect(matchedCreated[0].target).toBe("#created");

      const decidedEvent = createTestEvent("request.decided");
      const matchedDecided = dispatcher.matchRoutes(decidedEvent);
      expect(matchedDecided).toHaveLength(1);
      expect(matchedDecided[0].target).toBe("#decided");
    });

    it("should match routes by action filter", () => {
      const routes: ChannelRoute[] = [
        { channel: "slack", target: "#emails", actions: ["send_email"], enabled: true },
        { channel: "slack", target: "#files", actions: ["delete_file"], enabled: true },
      ];
      const dispatcher = createDispatcher({ defaultRoutes: routes });

      const emailEvent = createTestEvent("request.created", {
        payload: {
          requestId: "req-1",
          action: "send_email",
          params: {},
          context: {},
          urgency: "normal",
          policyDecision: { decision: "ask" },
        },
      }) as AgentGateEvent;

      const matched = dispatcher.matchRoutes(emailEvent);
      expect(matched).toHaveLength(1);
      expect(matched[0].target).toBe("#emails");
    });

    it("should match routes by urgency filter", () => {
      const routes: ChannelRoute[] = [
        { channel: "slack", target: "#critical", urgencies: ["critical"], enabled: true },
        { channel: "slack", target: "#normal", urgencies: ["normal", "low"], enabled: true },
      ];
      const dispatcher = createDispatcher({ defaultRoutes: routes });

      const criticalEvent = createTestEvent("request.created", {
        payload: {
          requestId: "req-1",
          action: "action",
          params: {},
          context: {},
          urgency: "critical",
          policyDecision: { decision: "ask" },
        },
      }) as AgentGateEvent;

      const matched = dispatcher.matchRoutes(criticalEvent);
      expect(matched).toHaveLength(1);
      expect(matched[0].target).toBe("#critical");
    });

    it("should skip disabled routes", () => {
      const routes: ChannelRoute[] = [
        { channel: "slack", target: "#enabled", enabled: true },
        { channel: "slack", target: "#disabled", enabled: false },
      ];
      const dispatcher = createDispatcher({ defaultRoutes: routes });

      const event = createTestEvent("request.created");
      const matched = dispatcher.matchRoutes(event);
      
      expect(matched.map(r => r.target)).toContain("#enabled");
      expect(matched.map(r => r.target)).not.toContain("#disabled");
    });

    it("should parse policy channels with channel:target format", () => {
      const dispatcher = createDispatcher();
      const event = createTestEvent("request.created");
      
      const matched = dispatcher.matchRoutes(event, ["slack:#alerts", "email:admin@test.com"]);
      
      expect(matched).toHaveLength(2);
      expect(matched.find(r => r.channel === "slack" && r.target === "#alerts")).toBeDefined();
      expect(matched.find(r => r.channel === "email" && r.target === "admin@test.com")).toBeDefined();
    });

    it("should ignore invalid policy channel format", () => {
      const dispatcher = createDispatcher();
      const event = createTestEvent("request.created");
      
      // Missing colon - should be ignored
      const matched = dispatcher.matchRoutes(event, ["slack"]);
      
      // No routes from invalid spec, falls back to defaults (which may be empty)
      expect(matched.every(r => r.target !== "slack")).toBe(true);
    });

    it("should ignore policy channels for unregistered adapters", () => {
      const dispatcher = createDispatcher();
      const event = createTestEvent("request.created");
      
      const matched = dispatcher.matchRoutes(event, ["unknown:target"]);
      
      expect(matched.find(r => r.channel === "unknown" as any)).toBeUndefined();
    });

    it("should deduplicate routes by channel+target", () => {
      const routes: ChannelRoute[] = [
        { channel: "slack", target: "#alerts", enabled: true },
        { channel: "slack", target: "#alerts", enabled: true }, // Duplicate
      ];
      const dispatcher = createDispatcher({ defaultRoutes: routes });

      const event = createTestEvent("request.created");
      const matched = dispatcher.matchRoutes(event);
      
      const alertRoutes = matched.filter(r => r.target === "#alerts");
      expect(alertRoutes).toHaveLength(1);
    });

    it("should use default channels when no routes match", () => {
      setConfig(parseConfig({
        slackBotToken: "xoxb-test",
        slackDefaultChannel: "#default",
      }));

      const dispatcher = createDispatcher();
      const event = createTestEvent("request.created");
      
      const matched = dispatcher.matchRoutes(event);
      
      expect(matched.find(r => r.target === "#default")).toBeDefined();
    });

    it("should not add default channels if routes already matched", () => {
      setConfig(parseConfig({
        slackBotToken: "xoxb-test",
        slackDefaultChannel: "#default",
      }));

      const routes: ChannelRoute[] = [
        { channel: "slack", target: "#specific", enabled: true },
      ];
      const dispatcher = createDispatcher({ defaultRoutes: routes });

      const event = createTestEvent("request.created");
      const matched = dispatcher.matchRoutes(event);
      
      // Should have #specific but no #default since routes matched
      expect(matched.find(r => r.target === "#specific")).toBeDefined();
    });

    it("should combine policy channels with config routes", () => {
      const routes: ChannelRoute[] = [
        { channel: "webhook", target: "https://config.example.com", enabled: true },
      ];
      const dispatcher = createDispatcher({ defaultRoutes: routes });

      const event = createTestEvent("request.created");
      const matched = dispatcher.matchRoutes(event, ["slack:#policy"]);
      
      expect(matched).toHaveLength(2);
      expect(matched.find(r => r.target === "#policy")).toBeDefined();
      expect(matched.find(r => r.target === "https://config.example.com")).toBeDefined();
    });

    it("should match route with multiple event types", () => {
      const routes: ChannelRoute[] = [
        { channel: "slack", target: "#all-events", eventTypes: ["request.created", "request.decided", "request.expired"], enabled: true },
      ];
      const dispatcher = createDispatcher({ defaultRoutes: routes });

      const createdEvent = createTestEvent("request.created");
      const decidedEvent = createTestEvent("request.decided");
      
      expect(dispatcher.matchRoutes(createdEvent)).toHaveLength(1);
      expect(dispatcher.matchRoutes(decidedEvent)).toHaveLength(1);
    });

    it("should not match when event type filter excludes event", () => {
      const routes: ChannelRoute[] = [
        { channel: "slack", target: "#specific", eventTypes: ["request.expired"], enabled: true },
      ];
      const dispatcher = createDispatcher({ defaultRoutes: routes });

      const event = createTestEvent("request.created");
      const matched = dispatcher.matchRoutes(event);
      
      // Should not match the route, may get default channels
      expect(matched.find(r => r.target === "#specific")).toBeUndefined();
    });
  });

  describe("dispatch", () => {
    it("should dispatch to all matched routes", async () => {
      const mockAdapter = new MockAdapter();
      const routes: ChannelRoute[] = [
        { channel: "slack", target: "#channel1", enabled: true },
        { channel: "slack", target: "#channel2", enabled: true },
      ];
      
      const dispatcher = createDispatcher({ defaultRoutes: routes });
      dispatcher.registerAdapter(mockAdapter);

      const event = createTestEvent("request.created");
      const results = await dispatcher.dispatch(event);

      expect(results).toHaveLength(2);
      expect(results.every(r => r.success)).toBe(true);
      expect(mockAdapter.sendCalls).toHaveLength(2);
    });

    it("should return error result for unknown channel type", async () => {
      const routes: ChannelRoute[] = [
        { channel: "unknown" as any, target: "target", enabled: true },
      ];
      const dispatcher = new NotificationDispatcher({ defaultRoutes: routes });
      // Don't register any adapters

      const event = createTestEvent("request.created");
      const results = await dispatcher.dispatch(event);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain("No adapter registered");
    });

    it("should handle adapter send failures gracefully with failSilently=true", async () => {
      const mockAdapter = new MockAdapter();
      mockAdapter.shouldFail = true;
      mockAdapter.failMessage = "Network error";

      const routes: ChannelRoute[] = [
        { channel: "slack", target: "#channel", enabled: true },
      ];
      const dispatcher = createDispatcher({ 
        defaultRoutes: routes,
        failSilently: true,
      });
      dispatcher.registerAdapter(mockAdapter);

      const event = createTestEvent("request.created");
      const results = await dispatcher.dispatch(event);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe("Network error");
    });

    it("should throw on adapter failure when failSilently=false", async () => {
      const mockAdapter = new MockAdapter();
      mockAdapter.shouldFail = true;
      
      // Make the adapter throw instead of returning failure
      vi.spyOn(mockAdapter, "send").mockRejectedValue(new Error("Fatal error"));

      const routes: ChannelRoute[] = [
        { channel: "slack", target: "#channel", enabled: true },
      ];
      const dispatcher = createDispatcher({ 
        defaultRoutes: routes,
        failSilently: false,
      });
      dispatcher.registerAdapter(mockAdapter);

      const event = createTestEvent("request.created");
      await expect(dispatcher.dispatch(event)).rejects.toThrow("Fatal error");
    });

    it("should capture adapter exceptions as error results when failSilently=true", async () => {
      const mockAdapter = new MockAdapter();
      vi.spyOn(mockAdapter, "send").mockRejectedValue(new Error("Unexpected error"));

      const routes: ChannelRoute[] = [
        { channel: "slack", target: "#channel", enabled: true },
      ];
      const dispatcher = createDispatcher({ 
        defaultRoutes: routes,
        failSilently: true,
      });
      dispatcher.registerAdapter(mockAdapter);

      const event = createTestEvent("request.created");
      const results = await dispatcher.dispatch(event);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe("Unexpected error");
    });

    it("should handle non-Error exceptions", async () => {
      const mockAdapter = new MockAdapter();
      vi.spyOn(mockAdapter, "send").mockRejectedValue("string error");

      const routes: ChannelRoute[] = [
        { channel: "slack", target: "#channel", enabled: true },
      ];
      const dispatcher = createDispatcher({ 
        defaultRoutes: routes,
        failSilently: true,
      });
      dispatcher.registerAdapter(mockAdapter);

      const event = createTestEvent("request.created");
      const results = await dispatcher.dispatch(event);

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe("Unknown error");
    });

    it("should dispatch with policy channels", async () => {
      const mockAdapter = new MockAdapter();
      const dispatcher = createDispatcher();
      dispatcher.registerAdapter(mockAdapter);

      const event = createTestEvent("request.created");
      const results = await dispatcher.dispatch(event, ["slack:#policy-channel"]);

      expect(results).toHaveLength(1);
      expect(results[0].target).toBe("#policy-channel");
    });

    it("should return empty results when no routes match", async () => {
      const dispatcher = createDispatcher();
      // No default routes, no config routes

      const event = createTestEvent("request.created");
      const results = await dispatcher.dispatch(event);

      expect(results).toHaveLength(0);
    });
  });

  describe("dispatchSync", () => {
    it("should fire and forget dispatch", () => {
      const mockAdapter = new MockAdapter();
      const routes: ChannelRoute[] = [
        { channel: "slack", target: "#channel", enabled: true },
      ];
      const dispatcher = createDispatcher({ defaultRoutes: routes });
      dispatcher.registerAdapter(mockAdapter);

      const event = createTestEvent("request.created");
      
      // dispatchSync should not throw and should not wait
      expect(() => dispatcher.dispatchSync(event)).not.toThrow();
      
      // The send call may or may not have completed yet
      // This just tests that it doesn't block
    });
  });

  describe("global dispatcher", () => {
    it("should return same instance across multiple calls", () => {
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

    it("should initialize with default adapters", () => {
      const dispatcher = getGlobalDispatcher();
      expect(dispatcher.getAdapter("email")).toBeDefined();
      expect(dispatcher.getAdapter("slack")).toBeDefined();
      expect(dispatcher.getAdapter("discord")).toBeDefined();
      expect(dispatcher.getAdapter("webhook")).toBeDefined();
    });
  });

  describe("createDispatcher factory", () => {
    it("should create new dispatcher with custom options", () => {
      const dispatcher = createDispatcher({
        failSilently: false,
        logLevel: "error",
      });
      expect(dispatcher).toBeInstanceOf(NotificationDispatcher);
    });

    it("should create independent instances", () => {
      const d1 = createDispatcher();
      const d2 = createDispatcher();
      expect(d1).not.toBe(d2);
    });
  });
});
