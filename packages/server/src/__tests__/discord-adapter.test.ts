import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { AgentGateEvent } from "@agentgate/core";
import {
  DiscordAdapter,
  getEventColor,
  buildDiscordEmbed,
  buildRequestCreatedEmbed,
  buildRequestDecidedEmbed,
  buildGenericEmbed,
} from "../lib/notification/adapters/discord.js";
import { resetConfig, setConfig, parseConfig } from "../config.js";

function createRequestCreatedEvent(overrides: Partial<any> = {}): AgentGateEvent {
  return {
    eventId: "evt-123",
    timestamp: Date.now(),
    source: "test",
    type: "request.created",
    payload: {
      requestId: "req-123",
      action: "send_email",
      params: { to: "user@example.com" },
      context: { source: "test-agent" },
      urgency: "normal",
      policyDecision: { decision: "ask", policyId: "policy-1" },
      ...overrides,
    },
  } as AgentGateEvent;
}

function createRequestDecidedEvent(overrides: Partial<any> = {}): AgentGateEvent {
  return {
    eventId: "evt-456",
    timestamp: Date.now(),
    source: "test",
    type: "request.decided",
    payload: {
      requestId: "req-123",
      action: "send_email",
      status: "approved",
      decidedBy: "admin@example.com",
      decidedByType: "human",
      decisionTimeMs: 5000,
      ...overrides,
    },
  } as AgentGateEvent;
}

describe("Discord Adapter Unit Tests", () => {
  beforeEach(() => {
    resetConfig();
    setConfig(parseConfig({}));
  });

  afterEach(() => {
    resetConfig();
    vi.restoreAllMocks();
  });

  describe("getEventColor", () => {
    it("should return green for approved status", () => {
      const event = createRequestDecidedEvent({ status: "approved" });
      expect(getEventColor(event)).toBe(0x22c55e);
    });

    it("should return red for denied status", () => {
      const event = createRequestDecidedEvent({ status: "denied" });
      expect(getEventColor(event)).toBe(0xef4444);
    });

    it("should return green for low urgency", () => {
      const event = createRequestCreatedEvent({ urgency: "low" });
      expect(getEventColor(event)).toBe(0x22c55e);
    });

    it("should return yellow for normal urgency", () => {
      const event = createRequestCreatedEvent({ urgency: "normal" });
      expect(getEventColor(event)).toBe(0xeab308);
    });

    it("should return orange for high urgency", () => {
      const event = createRequestCreatedEvent({ urgency: "high" });
      expect(getEventColor(event)).toBe(0xf97316);
    });

    it("should return red for critical urgency", () => {
      const event = createRequestCreatedEvent({ urgency: "critical" });
      expect(getEventColor(event)).toBe(0xef4444);
    });

    it("should return gray for unknown urgency", () => {
      const event = createRequestCreatedEvent({ urgency: "unknown" });
      expect(getEventColor(event)).toBe(0x6b7280);
    });

    it("should return gray for events without payload", () => {
      const event = {
        eventId: "evt-123",
        timestamp: Date.now(),
        source: "test",
        type: "custom.event",
      } as AgentGateEvent;
      expect(getEventColor(event)).toBe(0x6b7280);
    });

    it("should prioritize status over urgency", () => {
      // When both status and urgency exist, status should take precedence
      const event = {
        eventId: "evt-123",
        timestamp: Date.now(),
        source: "test",
        type: "request.decided",
        payload: {
          status: "approved",
          urgency: "critical", // Should be ignored
        },
      } as AgentGateEvent;
      expect(getEventColor(event)).toBe(0x22c55e); // Green for approved
    });
  });

  describe("buildRequestCreatedEmbed", () => {
    it("should include title with bell emoji", () => {
      const event = createRequestCreatedEvent();
      const embed = buildRequestCreatedEmbed(event as any) as any;
      expect(embed.title).toBe("🔔 Approval Request");
    });

    it("should include action field", () => {
      const event = createRequestCreatedEvent({ action: "delete_files" });
      const embed = buildRequestCreatedEmbed(event as any) as any;
      
      const actionField = embed.fields.find((f: any) => f.name === "Action");
      expect(actionField).toBeDefined();
      expect(actionField.value).toBe("`delete_files`");
      expect(actionField.inline).toBe(true);
    });

    it("should include urgency field with uppercase", () => {
      const event = createRequestCreatedEvent({ urgency: "critical" });
      const embed = buildRequestCreatedEmbed(event as any) as any;
      
      const urgencyField = embed.fields.find((f: any) => f.name === "Urgency");
      expect(urgencyField).toBeDefined();
      expect(urgencyField.value).toBe("CRITICAL");
    });

    it("should include request ID field", () => {
      const event = createRequestCreatedEvent({ requestId: "req-unique-id" });
      const embed = buildRequestCreatedEmbed(event as any) as any;
      
      const idField = embed.fields.find((f: any) => f.name === "Request ID");
      expect(idField).toBeDefined();
      expect(idField.value).toBe("`req-unique-id`");
    });

    it("should include params when present", () => {
      const event = createRequestCreatedEvent({ 
        params: { file: "/tmp/test.txt", recursive: true } 
      });
      const embed = buildRequestCreatedEmbed(event as any) as any;
      
      const paramsField = embed.fields.find((f: any) => f.name === "Parameters");
      expect(paramsField).toBeDefined();
      expect(paramsField.value).toContain("json");
      expect(paramsField.inline).toBe(false);
    });

    it("should not include params when empty", () => {
      const event = createRequestCreatedEvent({ params: {} });
      const embed = buildRequestCreatedEmbed(event as any) as any;
      
      const paramsField = embed.fields.find((f: any) => f.name === "Parameters");
      expect(paramsField).toBeUndefined();
    });

    it("should truncate large params", () => {
      const event = createRequestCreatedEvent({ 
        params: { data: "x".repeat(2000) } 
      });
      const embed = buildRequestCreatedEmbed(event as any) as any;
      
      const paramsField = embed.fields.find((f: any) => f.name === "Parameters");
      expect(paramsField.value.length).toBeLessThanOrEqual(1050); // 1000 + markdown
    });

    it("should include policy decision when present", () => {
      const event = createRequestCreatedEvent({ 
        policyDecision: { decision: "ask", policyId: "my-policy" } 
      });
      const embed = buildRequestCreatedEmbed(event as any) as any;
      
      const policyField = embed.fields.find((f: any) => f.name === "Policy Decision");
      expect(policyField).toBeDefined();
      expect(policyField.value).toContain("ask");
      expect(policyField.value).toContain("my-policy");
    });

    it("should include policy decision without policy ID", () => {
      const event = createRequestCreatedEvent({ 
        policyDecision: { decision: "auto-approve" } 
      });
      const embed = buildRequestCreatedEmbed(event as any) as any;
      
      const policyField = embed.fields.find((f: any) => f.name === "Policy Decision");
      expect(policyField.value).toBe("auto-approve");
    });

    it("should not include policy decision when absent", () => {
      const event = createRequestCreatedEvent({ policyDecision: undefined });
      const embed = buildRequestCreatedEmbed(event as any) as any;
      
      const policyField = embed.fields.find((f: any) => f.name === "Policy Decision");
      expect(policyField).toBeUndefined();
    });

    it("should include timestamp", () => {
      const timestamp = Date.now();
      const event = createRequestCreatedEvent();
      (event as any).timestamp = timestamp;
      const embed = buildRequestCreatedEmbed(event as any) as any;
      
      expect(embed.timestamp).toBe(new Date(timestamp).toISOString());
    });

    it("should include event ID in footer", () => {
      const event = createRequestCreatedEvent();
      (event as any).eventId = "evt-footer-test";
      const embed = buildRequestCreatedEmbed(event as any) as any;
      
      expect(embed.footer.text).toContain("evt-footer-test");
    });
  });

  describe("buildRequestDecidedEmbed", () => {
    it("should show approved with green check emoji", () => {
      const event = createRequestDecidedEvent({ status: "approved" });
      const embed = buildRequestDecidedEmbed(event as any) as any;
      
      expect(embed.title).toBe("✅ Request Approved");
    });

    it("should show denied with red X emoji", () => {
      const event = createRequestDecidedEvent({ status: "denied" });
      const embed = buildRequestDecidedEmbed(event as any) as any;
      
      expect(embed.title).toBe("❌ Request Denied");
    });

    it("should include action field", () => {
      const event = createRequestDecidedEvent({ action: "exec_command" });
      const embed = buildRequestDecidedEmbed(event as any) as any;
      
      const actionField = embed.fields.find((f: any) => f.name === "Action");
      expect(actionField.value).toBe("`exec_command`");
    });

    it("should include status field with uppercase", () => {
      const event = createRequestDecidedEvent({ status: "approved" });
      const embed = buildRequestDecidedEmbed(event as any) as any;
      
      const statusField = embed.fields.find((f: any) => f.name === "Status");
      expect(statusField.value).toBe("APPROVED");
    });

    it("should include decided by field", () => {
      const event = createRequestDecidedEvent({ 
        decidedBy: "admin@test.com",
        decidedByType: "human",
      });
      const embed = buildRequestDecidedEmbed(event as any) as any;
      
      const decidedByField = embed.fields.find((f: any) => f.name === "Decided By");
      expect(decidedByField.value).toBe("admin@test.com (human)");
    });

    it("should include decision time field", () => {
      const event = createRequestDecidedEvent({ decisionTimeMs: 3500 });
      const embed = buildRequestDecidedEmbed(event as any) as any;
      
      const timeField = embed.fields.find((f: any) => f.name === "Decision Time");
      expect(timeField.value).toBe("3.5s");
    });

    it("should include reason when present", () => {
      const event = createRequestDecidedEvent({ reason: "Approved by security team" });
      const embed = buildRequestDecidedEmbed(event as any) as any;
      
      const reasonField = embed.fields.find((f: any) => f.name === "Reason");
      expect(reasonField).toBeDefined();
      expect(reasonField.value).toBe("Approved by security team");
      expect(reasonField.inline).toBe(false);
    });

    it("should not include reason when absent", () => {
      const event = createRequestDecidedEvent({ reason: undefined });
      const embed = buildRequestDecidedEmbed(event as any) as any;
      
      const reasonField = embed.fields.find((f: any) => f.name === "Reason");
      expect(reasonField).toBeUndefined();
    });

    it("should include request ID in footer", () => {
      const event = createRequestDecidedEvent({ requestId: "req-footer-id" });
      const embed = buildRequestDecidedEmbed(event as any) as any;
      
      expect(embed.footer.text).toBe("Request ID: req-footer-id");
    });
  });

  describe("buildGenericEmbed", () => {
    it("should include event type in title", () => {
      const event = {
        eventId: "evt-123",
        timestamp: Date.now(),
        source: "test",
        type: "request.expired",
        payload: { requestId: "req-123" },
      } as AgentGateEvent;
      
      const embed = buildGenericEmbed(event) as any;
      expect(embed.title).toBe("📢 request.expired");
    });

    it("should include payload as JSON in description", () => {
      const event = {
        eventId: "evt-123",
        timestamp: Date.now(),
        source: "test",
        type: "custom.event",
        payload: { key: "value", count: 42 },
      } as AgentGateEvent;
      
      const embed = buildGenericEmbed(event) as any;
      expect(embed.description).toContain("json");
      expect(embed.description).toContain("key");
      expect(embed.description).toContain("value");
    });

    it("should handle empty payload", () => {
      const event = {
        eventId: "evt-123",
        timestamp: Date.now(),
        source: "test",
        type: "empty.event",
        payload: {},
      } as AgentGateEvent;
      
      const embed = buildGenericEmbed(event) as any;
      expect(embed.description).toContain("{}");
    });

    it("should handle events without payload", () => {
      const event = {
        eventId: "evt-123",
        timestamp: Date.now(),
        source: "test",
        type: "no-payload.event",
      } as AgentGateEvent;
      
      const embed = buildGenericEmbed(event) as any;
      expect(embed.description).toContain("{}");
    });

    it("should truncate large payloads", () => {
      const event = {
        eventId: "evt-123",
        timestamp: Date.now(),
        source: "test",
        type: "large.event",
        payload: { data: "x".repeat(5000) },
      } as AgentGateEvent;
      
      const embed = buildGenericEmbed(event) as any;
      expect(embed.description.length).toBeLessThanOrEqual(2100);
    });

    it("should include event ID and source in footer", () => {
      const event = {
        eventId: "evt-unique",
        timestamp: Date.now(),
        source: "my-source",
        type: "test.event",
        payload: {},
      } as AgentGateEvent;
      
      const embed = buildGenericEmbed(event) as any;
      expect(embed.footer.text).toContain("evt-unique");
      expect(embed.footer.text).toContain("my-source");
    });
  });

  describe("buildDiscordEmbed", () => {
    it("should route request.created to buildRequestCreatedEmbed", () => {
      const event = createRequestCreatedEvent();
      const embed = buildDiscordEmbed(event) as any;
      expect(embed.title).toBe("🔔 Approval Request");
    });

    it("should route request.decided to buildRequestDecidedEmbed", () => {
      const event = createRequestDecidedEvent();
      const embed = buildDiscordEmbed(event) as any;
      expect(embed.title).toMatch(/Request (Approved|Denied)/);
    });

    it("should route other events to buildGenericEmbed", () => {
      const event = {
        eventId: "evt-123",
        timestamp: Date.now(),
        source: "test",
        type: "request.expired",
        payload: {},
      } as AgentGateEvent;
      
      const embed = buildDiscordEmbed(event) as any;
      expect(embed.title).toBe("📢 request.expired");
    });
  });

  describe("DiscordAdapter", () => {
    describe("type", () => {
      it("should have type discord", () => {
        const adapter = new DiscordAdapter();
        expect(adapter.type).toBe("discord");
      });
    });

    describe("isConfigured", () => {
      it("should return false when discord bot token is not set", () => {
        const adapter = new DiscordAdapter();
        expect(adapter.isConfigured()).toBe(false);
      });

      it("should return true when discord bot token is set", () => {
        setConfig(parseConfig({ discordBotToken: "discord-bot-token" }));
        const adapter = new DiscordAdapter();
        expect(adapter.isConfigured()).toBe(true);
      });
    });

    describe("send via bot API", () => {
      it("should return error when not configured and not a webhook URL", async () => {
        const adapter = new DiscordAdapter();
        const event = createRequestCreatedEvent();
        
        const result = await adapter.send("123456789", event);
        
        expect(result.success).toBe(false);
        expect(result.error).toContain("not configured");
      });

      it("should call Discord API when configured", async () => {
        setConfig(parseConfig({ discordBotToken: "my-bot-token" }));
        
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ id: "message-123" }),
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new DiscordAdapter();
        const event = createRequestCreatedEvent();
        
        const result = await adapter.send("channel-id-123", event);
        
        expect(mockFetch).toHaveBeenCalledWith(
          "https://discord.com/api/v10/channels/channel-id-123/messages",
          expect.objectContaining({
            method: "POST",
            headers: expect.objectContaining({
              Authorization: "Bot my-bot-token",
            }),
          })
        );
        expect(result.success).toBe(true);
        expect(result.response).toEqual({ messageId: "message-123" });
      });

      it("should return error on Discord API failure", async () => {
        setConfig(parseConfig({ discordBotToken: "my-bot-token" }));
        
        const mockFetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          text: () => Promise.resolve("Unknown Channel"),
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new DiscordAdapter();
        const event = createRequestCreatedEvent();
        
        const result = await adapter.send("invalid-channel", event);
        
        expect(result.success).toBe(false);
        expect(result.error).toContain("404");
      });

      it("should handle network errors", async () => {
        setConfig(parseConfig({ discordBotToken: "my-bot-token" }));
        
        const mockFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new DiscordAdapter();
        const event = createRequestCreatedEvent();
        
        const result = await adapter.send("channel-id", event);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe("Connection refused");
      });

      it("should handle non-Error exceptions", async () => {
        setConfig(parseConfig({ discordBotToken: "my-bot-token" }));
        
        const mockFetch = vi.fn().mockRejectedValue("unknown error");
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new DiscordAdapter();
        const event = createRequestCreatedEvent();
        
        const result = await adapter.send("channel-id", event);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe("Unknown Discord error");
      });
    });

    describe("send via webhook", () => {
      it("should detect webhook URL and use webhook endpoint", async () => {
        const webhookUrl = "https://discord.com/api/webhooks/123/abc-token";
        
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new DiscordAdapter();
        const event = createRequestCreatedEvent();
        
        const result = await adapter.send(webhookUrl, event);
        
        expect(mockFetch).toHaveBeenCalledWith(
          webhookUrl,
          expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json" },
          })
        );
        expect(result.success).toBe(true);
      });

      it("should include username in webhook payload", async () => {
        const webhookUrl = "https://discord.com/api/webhooks/123/token";
        
        let capturedBody: any;
        const mockFetch = vi.fn().mockImplementation((_url, options) => {
          capturedBody = JSON.parse(options.body);
          return Promise.resolve({ ok: true });
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new DiscordAdapter();
        const event = createRequestCreatedEvent();
        
        await adapter.send(webhookUrl, event);
        
        expect(capturedBody.username).toBe("AgentGate");
        expect(capturedBody.embeds).toBeDefined();
      });

      it("should handle webhook errors", async () => {
        const webhookUrl = "https://discord.com/api/webhooks/123/token";
        
        const mockFetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: () => Promise.resolve("Invalid webhook"),
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new DiscordAdapter();
        const event = createRequestCreatedEvent();
        
        const result = await adapter.send(webhookUrl, event);
        
        expect(result.success).toBe(false);
        expect(result.error).toContain("webhook error");
        expect(result.error).toContain("400");
      });

      it("should handle webhook network errors", async () => {
        const webhookUrl = "https://discord.com/api/webhooks/123/token";
        
        const mockFetch = vi.fn().mockRejectedValue(new Error("DNS lookup failed"));
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new DiscordAdapter();
        const event = createRequestCreatedEvent();
        
        const result = await adapter.send(webhookUrl, event);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe("DNS lookup failed");
      });

      it("should handle webhook non-Error exceptions", async () => {
        const webhookUrl = "https://discord.com/api/webhooks/123/token";
        
        const mockFetch = vi.fn().mockRejectedValue({ message: "weird error" });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new DiscordAdapter();
        const event = createRequestCreatedEvent();
        
        const result = await adapter.send(webhookUrl, event);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe("Unknown Discord webhook error");
      });

      it("should work without bot token for webhooks", async () => {
        // No discord bot token configured
        const webhookUrl = "https://discord.com/api/webhooks/123/token";
        
        const mockFetch = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new DiscordAdapter();
        expect(adapter.isConfigured()).toBe(false);
        
        const event = createRequestCreatedEvent();
        const result = await adapter.send(webhookUrl, event);
        
        expect(result.success).toBe(true);
      });
    });
  });
});
