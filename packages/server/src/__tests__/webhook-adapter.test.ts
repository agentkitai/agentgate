import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { AgentGateEvent } from "@agentgate/core";
import {
  WebhookAdapter,
  signPayload,
  buildWebhookPayload,
} from "../lib/notification/adapters/webhook.js";
import { resetConfig, setConfig, parseConfig } from "../config.js";

function createTestEvent(type: string = "request.created", overrides: Partial<any> = {}): AgentGateEvent {
  return {
    eventId: "evt-123",
    timestamp: 1704067200000, // Fixed timestamp for testing
    source: "test",
    type,
    payload: {
      requestId: "req-123",
      action: "test_action",
      ...overrides,
    },
  } as AgentGateEvent;
}

describe("Webhook Adapter Unit Tests", () => {
  beforeEach(() => {
    resetConfig();
    setConfig(parseConfig({}));
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetConfig();
    vi.restoreAllMocks();
  });

  describe("signPayload", () => {
    it("should create HMAC-SHA256 signature", () => {
      const payload = '{"test":"data"}';
      const secret = "my-secret-key";
      
      const signature = signPayload(payload, secret);
      
      expect(signature).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should produce different signatures for different payloads", () => {
      const secret = "my-secret";
      
      const sig1 = signPayload('{"a":1}', secret);
      const sig2 = signPayload('{"a":2}', secret);
      
      expect(sig1).not.toBe(sig2);
    });

    it("should produce different signatures for different secrets", () => {
      const payload = '{"test":"data"}';
      
      const sig1 = signPayload(payload, "secret1");
      const sig2 = signPayload(payload, "secret2");
      
      expect(sig1).not.toBe(sig2);
    });

    it("should produce consistent signatures", () => {
      const payload = '{"consistent":"test"}';
      const secret = "consistent-secret";
      
      const sig1 = signPayload(payload, secret);
      const sig2 = signPayload(payload, secret);
      
      expect(sig1).toBe(sig2);
    });

    it("should handle empty payload", () => {
      const signature = signPayload("", "secret");
      expect(signature).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should handle unicode characters", () => {
      const payload = '{"message":"Hello 世界 🌍"}';
      const signature = signPayload(payload, "secret");
      expect(signature).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("buildWebhookPayload", () => {
    it("should include event type", () => {
      const event = createTestEvent("request.created");
      const payload = buildWebhookPayload(event);
      expect(payload.event).toBe("request.created");
    });

    it("should include timestamp", () => {
      const event = createTestEvent();
      const payload = buildWebhookPayload(event);
      expect(payload.timestamp).toBe(1704067200000);
    });

    it("should include eventId", () => {
      const event = createTestEvent();
      const payload = buildWebhookPayload(event);
      expect(payload.eventId).toBe("evt-123");
    });

    it("should include source", () => {
      const event = createTestEvent();
      const payload = buildWebhookPayload(event);
      expect(payload.source).toBe("test");
    });

    it("should include payload data", () => {
      const event = createTestEvent("request.created", { 
        requestId: "req-456",
        action: "custom_action",
      });
      const payload = buildWebhookPayload(event);
      expect(payload.data).toEqual({
        requestId: "req-456",
        action: "custom_action",
      });
    });

    it("should handle events without payload", () => {
      const event = {
        eventId: "evt-123",
        timestamp: Date.now(),
        source: "test",
        type: "ping",
      } as AgentGateEvent;
      
      const payload = buildWebhookPayload(event);
      expect(payload.data).toEqual({});
    });

    it("should handle complex nested payload", () => {
      const event = createTestEvent("request.created", {
        params: { nested: { deep: { value: 123 } } },
        context: { array: [1, 2, 3] },
      });
      const payload = buildWebhookPayload(event);
      expect(payload.data.params.nested.deep.value).toBe(123);
      expect(payload.data.context.array).toEqual([1, 2, 3]);
    });
  });

  describe("WebhookAdapter", () => {
    describe("type", () => {
      it("should have type webhook", () => {
        const adapter = new WebhookAdapter();
        expect(adapter.type).toBe("webhook");
      });
    });

    describe("isConfigured", () => {
      it("should always return true", () => {
        const adapter = new WebhookAdapter();
        expect(adapter.isConfigured()).toBe(true);
      });

      it("should return true even without any configuration", () => {
        resetConfig();
        setConfig(parseConfig({}));
        const adapter = new WebhookAdapter();
        expect(adapter.isConfigured()).toBe(true);
      });
    });

    describe("send - URL validation", () => {
      it("should reject invalid URL", async () => {
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        const result = await adapter.send("not-a-url", event);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe("Invalid webhook URL");
      });

      it("should reject URL without protocol", async () => {
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        const result = await adapter.send("example.com/webhook", event);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe("Invalid webhook URL");
      });

      it("should accept valid HTTP URL", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        const result = await adapter.send("http://example.com/webhook", event);
        
        expect(result.success).toBe(true);
        expect(mockFetch).toHaveBeenCalled();
      });

      it("should accept valid HTTPS URL", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        const result = await adapter.send("https://secure.example.com/webhook", event);
        
        expect(result.success).toBe(true);
      });

      it("should accept URL with query parameters", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        const result = await adapter.send("https://example.com/webhook?token=abc&type=event", event);
        
        expect(result.success).toBe(true);
      });
    });

    describe("send - request formatting", () => {
      it("should send POST request", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        await adapter.send("https://example.com/hook", event);
        
        expect(mockFetch).toHaveBeenCalledWith(
          "https://example.com/hook",
          expect.objectContaining({
            method: "POST",
          })
        );
      });

      it("should set Content-Type header", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        await adapter.send("https://example.com/hook", event);
        
        const callArgs = mockFetch.mock.calls[0][1];
        expect(callArgs.headers["Content-Type"]).toBe("application/json");
      });

      it("should set X-AgentGate-Event header", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent("request.decided");
        
        await adapter.send("https://example.com/hook", event);
        
        const callArgs = mockFetch.mock.calls[0][1];
        expect(callArgs.headers["X-AgentGate-Event"]).toBe("request.decided");
      });

      it("should set X-AgentGate-EventId header", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        await adapter.send("https://example.com/hook", event);
        
        const callArgs = mockFetch.mock.calls[0][1];
        expect(callArgs.headers["X-AgentGate-EventId"]).toBe("evt-123");
      });

      it("should set X-AgentGate-Timestamp header", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        await adapter.send("https://example.com/hook", event);
        
        const callArgs = mockFetch.mock.calls[0][1];
        expect(callArgs.headers["X-AgentGate-Timestamp"]).toBe("1704067200000");
      });

      it("should send JSON body", async () => {
        let capturedBody: any;
        const mockFetch = vi.fn().mockImplementation((_url, options) => {
          capturedBody = JSON.parse(options.body);
          return Promise.resolve({ ok: true, status: 200 });
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent("request.created", { action: "test" });
        
        await adapter.send("https://example.com/hook", event);
        
        expect(capturedBody.event).toBe("request.created");
        expect(capturedBody.data.action).toBe("test");
      });
    });

    describe("send - signature", () => {
      it("should not add signature header when no secret", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        await adapter.send("https://example.com/hook", event);
        
        const callArgs = mockFetch.mock.calls[0][1];
        expect(callArgs.headers["X-AgentGate-Signature"]).toBeUndefined();
      });

      it("should add signature header when secret is provided", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter({ secret: "my-webhook-secret" });
        const event = createTestEvent();
        
        await adapter.send("https://example.com/hook", event);
        
        const callArgs = mockFetch.mock.calls[0][1];
        expect(callArgs.headers["X-AgentGate-Signature"]).toBeDefined();
        expect(callArgs.headers["X-AgentGate-Signature"]).toMatch(/^[a-f0-9]{64}$/);
      });

      it("should produce valid signature that can be verified", async () => {
        let capturedBody: string;
        let capturedSignature: string;
        
        const mockFetch = vi.fn().mockImplementation((_url, options) => {
          capturedBody = options.body;
          capturedSignature = options.headers["X-AgentGate-Signature"];
          return Promise.resolve({ ok: true, status: 200 });
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const secret = "verification-test-secret";
        const adapter = new WebhookAdapter({ secret });
        const event = createTestEvent();
        
        await adapter.send("https://example.com/hook", event);
        
        // Verify signature matches
        const expectedSignature = signPayload(capturedBody!, secret);
        expect(capturedSignature!).toBe(expectedSignature);
      });
    });

    describe("send - timeout", () => {
      it("should use webhook timeout from config", async () => {
        setConfig(parseConfig({ webhookTimeoutMs: 10000 }));
        
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        await adapter.send("https://example.com/hook", event);
        
        // Check that AbortSignal.timeout was used
        const callArgs = mockFetch.mock.calls[0][1];
        expect(callArgs.signal).toBeDefined();
      });

      it("should handle timeout error", async () => {
        const mockFetch = vi.fn().mockRejectedValue({
          name: "TimeoutError",
          message: "The operation was aborted due to timeout",
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        const result = await adapter.send("https://slow.example.com/hook", event);
        
        expect(result.success).toBe(false);
        // Non-Error objects get "Unknown webhook error"
        expect(result.error).toBe("Unknown webhook error");
      });

      it("should handle Error with name TimeoutError", async () => {
        const timeoutError = new Error("The operation timed out");
        timeoutError.name = "TimeoutError";
        
        const mockFetch = vi.fn().mockRejectedValue(timeoutError);
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        const result = await adapter.send("https://slow.example.com/hook", event);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe("Request timed out");
      });
    });

    describe("send - response handling", () => {
      it("should return success on 200 response", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        const result = await adapter.send("https://example.com/hook", event);
        
        expect(result.success).toBe(true);
        expect(result.response).toEqual({ statusCode: 200 });
      });

      it("should return success on 201 response", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 201,
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        const result = await adapter.send("https://example.com/hook", event);
        
        expect(result.success).toBe(true);
        expect(result.response).toEqual({ statusCode: 201 });
      });

      it("should return success on 204 response", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 204,
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        const result = await adapter.send("https://example.com/hook", event);
        
        expect(result.success).toBe(true);
      });

      it("should return error on 400 response", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: () => Promise.resolve("Bad Request"),
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        const result = await adapter.send("https://example.com/hook", event);
        
        expect(result.success).toBe(false);
        expect(result.error).toContain("HTTP 400");
        expect(result.error).toContain("Bad Request");
        expect(result.response).toEqual({ statusCode: 400 });
      });

      it("should return error on 500 response", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          text: () => Promise.resolve("Internal Server Error"),
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        const result = await adapter.send("https://example.com/hook", event);
        
        expect(result.success).toBe(false);
        expect(result.error).toContain("HTTP 500");
      });

      it("should truncate long error responses", async () => {
        const longError = "x".repeat(500);
        const mockFetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: () => Promise.resolve(longError),
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        const result = await adapter.send("https://example.com/hook", event);
        
        expect(result.error!.length).toBeLessThanOrEqual(220); // HTTP 400: + 200 chars
      });

      it("should handle text() promise rejection", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 502,
          text: () => Promise.reject(new Error("Body read error")),
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        const result = await adapter.send("https://example.com/hook", event);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe("HTTP 502: ");
      });
    });

    describe("send - error handling", () => {
      it("should handle network errors", async () => {
        const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        const result = await adapter.send("https://unreachable.example.com/hook", event);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe("ECONNREFUSED");
      });

      it("should handle DNS errors", async () => {
        const mockFetch = vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        const result = await adapter.send("https://nonexistent.invalid/hook", event);
        
        expect(result.success).toBe(false);
        expect(result.error).toContain("ENOTFOUND");
      });

      it("should handle non-Error exceptions", async () => {
        const mockFetch = vi.fn().mockRejectedValue("string error");
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        const result = await adapter.send("https://example.com/hook", event);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe("Unknown webhook error");
      });

      it("should handle null rejection", async () => {
        const mockFetch = vi.fn().mockRejectedValue(null);
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        const result = await adapter.send("https://example.com/hook", event);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe("Unknown webhook error");
      });
    });

    describe("send - result metadata", () => {
      it("should include channel type in result", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        const result = await adapter.send("https://example.com/hook", event);
        
        expect(result.channel).toBe("webhook");
      });

      it("should include target in result", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        const result = await adapter.send("https://my-endpoint.example.com/webhook", event);
        
        expect(result.target).toBe("https://my-endpoint.example.com/webhook");
      });

      it("should include timestamp in result", async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
        });
        vi.stubGlobal("fetch", mockFetch);
        
        const beforeTime = Date.now();
        
        const adapter = new WebhookAdapter();
        const event = createTestEvent();
        
        const result = await adapter.send("https://example.com/hook", event);
        
        const afterTime = Date.now();
        
        expect(result.timestamp).toBeGreaterThanOrEqual(beforeTime);
        expect(result.timestamp).toBeLessThanOrEqual(afterTime);
      });
    });
  });
});
