import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { AgentGateEvent } from "@agentgate/core";
import {
  SlackAdapter,
  getUrgencyEmoji,
  formatJson,
  buildSlackBlocks,
  buildRequestCreatedBlocks,
  buildRequestDecidedBlocks,
  buildGenericBlocks,
} from "../lib/notification/adapters/slack.js";
import { resetConfig, setConfig, parseConfig } from "../config.js";

// Helper to create test events
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
      reason: "Looks good",
      ...overrides,
    },
  } as AgentGateEvent;
}

describe("Slack Adapter Unit Tests", () => {
  beforeEach(() => {
    resetConfig();
    setConfig(parseConfig({}));
  });

  afterEach(() => {
    resetConfig();
    vi.restoreAllMocks();
  });

  describe("getUrgencyEmoji", () => {
    it("should return red circle for critical", () => {
      expect(getUrgencyEmoji("critical")).toBe("🔴");
    });

    it("should return orange circle for high", () => {
      expect(getUrgencyEmoji("high")).toBe("🟠");
    });

    it("should return yellow circle for normal", () => {
      expect(getUrgencyEmoji("normal")).toBe("🟡");
    });

    it("should return green circle for low", () => {
      expect(getUrgencyEmoji("low")).toBe("🟢");
    });

    it("should return white circle for unknown urgency", () => {
      expect(getUrgencyEmoji("unknown")).toBe("⚪");
      expect(getUrgencyEmoji("")).toBe("⚪");
    });
  });

  describe("formatJson", () => {
    it("should format small objects as-is", () => {
      const obj = { key: "value" };
      const result = formatJson(obj);
      expect(result).toBe(JSON.stringify(obj, null, 2));
    });

    it("should truncate large objects", () => {
      const obj = { data: "x".repeat(1000) };
      const result = formatJson(obj, 100);
      expect(result.length).toBe(100);
      expect(result.endsWith("...")).toBe(true);
    });

    it("should respect custom max length", () => {
      const obj = { data: "test data here" };
      const result = formatJson(obj, 10);
      expect(result.length).toBe(10);
    });

    it("should not truncate when exactly at max length", () => {
      const obj = { a: 1 };
      const str = JSON.stringify(obj, null, 2);
      const result = formatJson(obj, str.length);
      expect(result).toBe(str);
    });

    it("should handle nested objects", () => {
      const obj = { level1: { level2: { level3: "value" } } };
      const result = formatJson(obj);
      expect(result).toContain("level1");
      expect(result).toContain("level3");
    });

    it("should handle arrays", () => {
      const obj = { items: [1, 2, 3] };
      const result = formatJson(obj);
      expect(result).toContain("[");
      expect(result).toContain("1");
    });
  });

  describe("buildRequestCreatedBlocks", () => {
    it("should include header block", () => {
      const event = createRequestCreatedEvent();
      const blocks = buildRequestCreatedBlocks(event as any);
      
      const header = blocks.find((b: any) => b.type === "header");
      expect(header).toBeDefined();
      expect((header as any).text.text).toContain("Approval Request");
    });

    it("should include action and urgency fields", () => {
      const event = createRequestCreatedEvent();
      const blocks = buildRequestCreatedBlocks(event as any);
      
      const section = blocks.find((b: any) => 
        b.type === "section" && b.fields
      );
      expect(section).toBeDefined();
      
      const fields = (section as any).fields;
      expect(fields.some((f: any) => f.text.includes("Action"))).toBe(true);
      expect(fields.some((f: any) => f.text.includes("Urgency"))).toBe(true);
    });

    it("should include params section when present", () => {
      const event = createRequestCreatedEvent({ params: { key: "value" } });
      const blocks = buildRequestCreatedBlocks(event as any);
      
      const paramsBlock = blocks.find((b: any) => 
        b.type === "section" && b.text?.text?.includes("Parameters")
      );
      expect(paramsBlock).toBeDefined();
    });

    it("should not include params section when empty", () => {
      const event = createRequestCreatedEvent({ params: {} });
      const blocks = buildRequestCreatedBlocks(event as any);
      
      const paramsBlock = blocks.find((b: any) => 
        b.type === "section" && b.text?.text?.includes("Parameters")
      );
      expect(paramsBlock).toBeUndefined();
    });

    it("should include context when present", () => {
      const event = createRequestCreatedEvent({ context: { source: "agent" } });
      const blocks = buildRequestCreatedBlocks(event as any);
      
      const contextBlock = blocks.find((b: any) => 
        b.type === "context" && b.elements?.some((e: any) => e.text?.includes("Context"))
      );
      expect(contextBlock).toBeDefined();
    });

    it("should not include context when empty", () => {
      const event = createRequestCreatedEvent({ context: {} });
      const blocks = buildRequestCreatedBlocks(event as any);
      
      const contextBlock = blocks.find((b: any) => 
        b.type === "context" && b.elements?.some((e: any) => e.text?.includes("📋 Context"))
      );
      expect(contextBlock).toBeUndefined();
    });

    it("should include policy decision when present", () => {
      const event = createRequestCreatedEvent({ 
        policyDecision: { decision: "ask", policyId: "my-policy" } 
      });
      const blocks = buildRequestCreatedBlocks(event as any);
      
      const policyBlock = blocks.find((b: any) => 
        b.type === "context" && b.elements?.some((e: any) => e.text?.includes("Policy decision"))
      );
      expect(policyBlock).toBeDefined();
    });

    it("should include interactive buttons by default", () => {
      const event = createRequestCreatedEvent();
      const blocks = buildRequestCreatedBlocks(event as any);
      
      const actionsBlock = blocks.find((b: any) => 
        b.type === "actions" && b.elements?.some((e: any) => e.action_id?.startsWith("approve_"))
      );
      expect(actionsBlock).toBeDefined();
    });

    it("should exclude interactive buttons when disabled", () => {
      const event = createRequestCreatedEvent();
      const blocks = buildRequestCreatedBlocks(event as any, { includeInteractiveButtons: false });
      
      const interactiveButtons = blocks.find((b: any) => 
        b.type === "actions" && b.elements?.some((e: any) => e.action_id?.startsWith("approve_"))
      );
      expect(interactiveButtons).toBeUndefined();
    });

    it("should include one-click link buttons when decision links provided", () => {
      const event = createRequestCreatedEvent();
      const decisionLinks = {
        approveUrl: "https://example.com/approve/token123",
        denyUrl: "https://example.com/deny/token456",
        expiresAt: new Date().toISOString(),
      };
      const blocks = buildRequestCreatedBlocks(event as any, { decisionLinks });
      
      const linkButtons = blocks.find((b: any) => 
        b.type === "actions" && b.elements?.some((e: any) => e.url?.includes("approve"))
      );
      expect(linkButtons).toBeDefined();
    });

    it("should include expiry note when decision links provided", () => {
      const event = createRequestCreatedEvent();
      const expiresAt = new Date().toISOString();
      const decisionLinks = {
        approveUrl: "https://example.com/approve",
        denyUrl: "https://example.com/deny",
        expiresAt,
      };
      const blocks = buildRequestCreatedBlocks(event as any, { decisionLinks });
      
      const expiryNote = blocks.find((b: any) => 
        b.type === "context" && b.elements?.some((e: any) => e.text?.includes("expire"))
      );
      expect(expiryNote).toBeDefined();
    });

    it("should include divider before buttons", () => {
      const event = createRequestCreatedEvent();
      const blocks = buildRequestCreatedBlocks(event as any);
      
      const divider = blocks.find((b: any) => b.type === "divider");
      expect(divider).toBeDefined();
    });
  });

  describe("buildRequestDecidedBlocks", () => {
    it("should show approved status with green emoji", () => {
      const event = createRequestDecidedEvent({ status: "approved" });
      const blocks = buildRequestDecidedBlocks(event as any);
      
      const header = blocks.find((b: any) => b.type === "header");
      expect((header as any).text.text).toContain("✅");
      expect((header as any).text.text).toContain("Approved");
    });

    it("should show denied status with red emoji", () => {
      const event = createRequestDecidedEvent({ status: "denied" });
      const blocks = buildRequestDecidedBlocks(event as any);
      
      const header = blocks.find((b: any) => b.type === "header");
      expect((header as any).text.text).toContain("❌");
      expect((header as any).text.text).toContain("Denied");
    });

    it("should include decided by info", () => {
      const event = createRequestDecidedEvent({ 
        decidedBy: "admin@test.com",
        decidedByType: "human",
      });
      const blocks = buildRequestDecidedBlocks(event as any);
      
      const section = blocks.find((b: any) => 
        b.type === "section" && b.fields?.some((f: any) => f.text?.includes("Decided by"))
      );
      expect(section).toBeDefined();
    });

    it("should include decision time in context", () => {
      const event = createRequestDecidedEvent({ decisionTimeMs: 5000 });
      const blocks = buildRequestDecidedBlocks(event as any);
      
      const context = blocks.find((b: any) => 
        b.type === "context" && b.elements?.some((e: any) => e.text?.includes("Decision time"))
      );
      expect(context).toBeDefined();
    });

    it("should include reason when present", () => {
      const event = createRequestDecidedEvent({ reason: "Approved by policy" });
      const blocks = buildRequestDecidedBlocks(event as any);
      
      const context = blocks.find((b: any) => 
        b.type === "context" && b.elements?.some((e: any) => e.text?.includes("Approved by policy"))
      );
      expect(context).toBeDefined();
    });

    it("should not include reason when absent", () => {
      const event = createRequestDecidedEvent({ reason: undefined });
      const blocks = buildRequestDecidedBlocks(event as any);
      
      const context = blocks.find((b: any) => b.type === "context") as any;
      expect(context.elements[0].text).not.toContain("Reason");
    });
  });

  describe("buildGenericBlocks", () => {
    it("should create header with event type", () => {
      const event = {
        eventId: "evt-789",
        timestamp: Date.now(),
        source: "test",
        type: "request.expired",
        payload: { requestId: "req-123" },
      } as AgentGateEvent;
      
      const blocks = buildGenericBlocks(event);
      const header = blocks.find((b: any) => b.type === "header");
      expect((header as any).text.text).toContain("request.expired");
    });

    it("should include event payload as JSON", () => {
      const event = {
        eventId: "evt-789",
        timestamp: Date.now(),
        source: "test",
        type: "request.escalated",
        payload: { requestId: "req-123", newUrgency: "critical" },
      } as AgentGateEvent;
      
      const blocks = buildGenericBlocks(event);
      const section = blocks.find((b: any) => 
        b.type === "section" && b.text?.text?.includes("```")
      );
      expect(section).toBeDefined();
    });

    it("should include event ID in context", () => {
      const event = {
        eventId: "evt-unique-id",
        timestamp: Date.now(),
        source: "test-source",
        type: "custom.event",
        payload: {},
      } as AgentGateEvent;
      
      const blocks = buildGenericBlocks(event);
      const context = blocks.find((b: any) => b.type === "context");
      expect((context as any).elements[0].text).toContain("evt-unique-id");
      expect((context as any).elements[0].text).toContain("test-source");
    });

    it("should truncate large payloads", () => {
      const event = {
        eventId: "evt-789",
        timestamp: Date.now(),
        source: "test",
        type: "large.event",
        payload: { data: "x".repeat(5000) },
      } as AgentGateEvent;
      
      const blocks = buildGenericBlocks(event);
      const section = blocks.find((b: any) => b.type === "section") as any;
      // Should be truncated to around 2900 chars + markdown
      expect(section.text.text.length).toBeLessThan(3100);
    });
  });

  describe("buildSlackBlocks", () => {
    it("should route request.created to buildRequestCreatedBlocks", () => {
      const event = createRequestCreatedEvent();
      const blocks = buildSlackBlocks(event);
      
      const header = blocks.find((b: any) => b.type === "header");
      expect((header as any).text.text).toContain("Approval Request");
    });

    it("should route request.decided to buildRequestDecidedBlocks", () => {
      const event = createRequestDecidedEvent();
      const blocks = buildSlackBlocks(event);
      
      const header = blocks.find((b: any) => b.type === "header");
      expect((header as any).text.text).toMatch(/Approved|Denied/);
    });

    it("should route unknown events to buildGenericBlocks", () => {
      const event = {
        eventId: "evt-789",
        timestamp: Date.now(),
        source: "test",
        type: "request.expired",
        payload: { requestId: "req-123" },
      } as AgentGateEvent;
      
      const blocks = buildSlackBlocks(event);
      const header = blocks.find((b: any) => b.type === "header");
      expect((header as any).text.text).toContain("request.expired");
    });

    it("should pass options to buildRequestCreatedBlocks", () => {
      const event = createRequestCreatedEvent();
      const blocks = buildSlackBlocks(event, { includeInteractiveButtons: false });
      
      const interactiveButtons = blocks.find((b: any) => 
        b.type === "actions" && b.elements?.some((e: any) => e.action_id?.startsWith("approve_"))
      );
      expect(interactiveButtons).toBeUndefined();
    });
  });

  describe("SlackAdapter", () => {
    describe("isConfigured", () => {
      it("should return false when slack bot token is not set", () => {
        const adapter = new SlackAdapter();
        expect(adapter.isConfigured()).toBe(false);
      });

      it("should return true when slack bot token is set", () => {
        setConfig(parseConfig({ slackBotToken: "xoxb-test-token" }));
        const adapter = new SlackAdapter();
        expect(adapter.isConfigured()).toBe(true);
      });
    });

    describe("send", () => {
      it("should return error when not configured", async () => {
        const adapter = new SlackAdapter();
        const event = createRequestCreatedEvent();
        
        const result = await adapter.send("#channel", event);
        
        expect(result.success).toBe(false);
        expect(result.error).toContain("not configured");
      });

      it("should call Slack API when configured", async () => {
        setConfig(parseConfig({ slackBotToken: "xoxb-test-token" }));
        
        const mockFetch = vi.fn().mockResolvedValue({
          json: () => Promise.resolve({ ok: true, ts: "123456.789" }),
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new SlackAdapter();
        const event = createRequestCreatedEvent();
        
        const result = await adapter.send("#test-channel", event);
        
        expect(mockFetch).toHaveBeenCalledWith(
          "https://slack.com/api/chat.postMessage",
          expect.objectContaining({
            method: "POST",
            headers: expect.objectContaining({
              Authorization: "Bearer xoxb-test-token",
            }),
          })
        );
        expect(result.success).toBe(true);
      });

      it("should return error on Slack API failure", async () => {
        setConfig(parseConfig({ slackBotToken: "xoxb-test-token" }));
        
        const mockFetch = vi.fn().mockResolvedValue({
          json: () => Promise.resolve({ ok: false, error: "channel_not_found" }),
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new SlackAdapter();
        const event = createRequestCreatedEvent();
        
        const result = await adapter.send("#nonexistent", event);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe("channel_not_found");
      });

      it("should handle network errors", async () => {
        setConfig(parseConfig({ slackBotToken: "xoxb-test-token" }));
        
        const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new SlackAdapter();
        const event = createRequestCreatedEvent();
        
        const result = await adapter.send("#channel", event);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe("Network error");
      });

      it("should handle unknown errors", async () => {
        setConfig(parseConfig({ slackBotToken: "xoxb-test-token" }));
        
        const mockFetch = vi.fn().mockRejectedValue("string error");
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new SlackAdapter();
        const event = createRequestCreatedEvent();
        
        const result = await adapter.send("#channel", event);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe("Unknown Slack error");
      });
    });
  });
});
