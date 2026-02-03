import { describe, it, expect } from "vitest";
import {
  EventNames,
  createBaseEvent,
  eventMatchesFilter,
  type RequestCreatedEvent,
  type RequestDecidedEvent,
  type AgentGateEvent,
} from "../events.js";

describe("events", () => {
  describe("EventNames", () => {
    it("should have all request lifecycle events", () => {
      expect(EventNames.REQUEST_CREATED).toBe("request.created");
      expect(EventNames.REQUEST_UPDATED).toBe("request.updated");
      expect(EventNames.REQUEST_DECIDED).toBe("request.decided");
      expect(EventNames.REQUEST_EXPIRED).toBe("request.expired");
      expect(EventNames.REQUEST_ESCALATED).toBe("request.escalated");
    });

    it("should have all policy events", () => {
      expect(EventNames.POLICY_CREATED).toBe("policy.created");
      expect(EventNames.POLICY_UPDATED).toBe("policy.updated");
      expect(EventNames.POLICY_DELETED).toBe("policy.deleted");
      expect(EventNames.POLICY_MATCHED).toBe("policy.matched");
    });

    it("should have all webhook events", () => {
      expect(EventNames.WEBHOOK_TRIGGERED).toBe("webhook.triggered");
      expect(EventNames.WEBHOOK_FAILED).toBe("webhook.failed");
      expect(EventNames.WEBHOOK_RETRY).toBe("webhook.retry");
    });

    it("should have all API key events", () => {
      expect(EventNames.API_KEY_CREATED).toBe("api_key.created");
      expect(EventNames.API_KEY_REVOKED).toBe("api_key.revoked");
      expect(EventNames.API_KEY_RATE_LIMITED).toBe("api_key.rate_limited");
    });

    it("should have all system events", () => {
      expect(EventNames.SYSTEM_STARTUP).toBe("system.startup");
      expect(EventNames.SYSTEM_SHUTDOWN).toBe("system.shutdown");
      expect(EventNames.SYSTEM_ERROR).toBe("system.error");
    });
  });

  describe("createBaseEvent", () => {
    it("should create event with required fields", () => {
      const event = createBaseEvent(EventNames.REQUEST_CREATED);

      expect(event.type).toBe("request.created");
      expect(event.source).toBe("agentgate");
      expect(typeof event.timestamp).toBe("number");
      expect(event.eventId).toMatch(/^evt_\d+_[a-z0-9]+$/);
    });

    it("should allow custom source", () => {
      const event = createBaseEvent(EventNames.REQUEST_CREATED, "custom-source");
      expect(event.source).toBe("custom-source");
    });

    it("should generate unique event IDs", () => {
      const event1 = createBaseEvent(EventNames.REQUEST_CREATED);
      const event2 = createBaseEvent(EventNames.REQUEST_CREATED);
      expect(event1.eventId).not.toBe(event2.eventId);
    });

    it("should set timestamp to current time", () => {
      const before = Date.now();
      const event = createBaseEvent(EventNames.REQUEST_CREATED);
      const after = Date.now();

      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("eventMatchesFilter", () => {
    const createRequestCreatedEvent = (
      action: string,
      urgency: "low" | "normal" | "high" | "critical" = "normal"
    ): RequestCreatedEvent => ({
      type: EventNames.REQUEST_CREATED,
      timestamp: Date.now(),
      eventId: "evt_test_123",
      source: "test",
      payload: {
        requestId: "req_123",
        action,
        params: {},
        context: {},
        urgency,
      },
    });

    const createRequestDecidedEvent = (
      action: string
    ): RequestDecidedEvent => ({
      type: EventNames.REQUEST_DECIDED,
      timestamp: Date.now(),
      eventId: "evt_test_456",
      source: "test",
      payload: {
        requestId: "req_123",
        action,
        status: "approved",
        decidedBy: "user_1",
        decidedByType: "human",
        decisionTimeMs: 5000,
      },
    });

    describe("type filtering", () => {
      it("should match when event type is in filter", () => {
        const event = createRequestCreatedEvent("send_email");
        const result = eventMatchesFilter(event, {
          types: [EventNames.REQUEST_CREATED, EventNames.REQUEST_DECIDED],
        });
        expect(result).toBe(true);
      });

      it("should not match when event type is not in filter", () => {
        const event = createRequestCreatedEvent("send_email");
        const result = eventMatchesFilter(event, {
          types: [EventNames.REQUEST_DECIDED],
        });
        expect(result).toBe(false);
      });

      it("should match when no type filter specified", () => {
        const event = createRequestCreatedEvent("send_email");
        const result = eventMatchesFilter(event, {});
        expect(result).toBe(true);
      });

      it("should match when type filter is empty array", () => {
        const event = createRequestCreatedEvent("send_email");
        const result = eventMatchesFilter(event, { types: [] });
        expect(result).toBe(true);
      });
    });

    describe("action filtering", () => {
      it("should match when action is in filter", () => {
        const event = createRequestCreatedEvent("send_email");
        const result = eventMatchesFilter(event, {
          actions: ["send_email", "transfer_funds"],
        });
        expect(result).toBe(true);
      });

      it("should not match when action is not in filter", () => {
        const event = createRequestCreatedEvent("send_email");
        const result = eventMatchesFilter(event, {
          actions: ["transfer_funds"],
        });
        expect(result).toBe(false);
      });

      it("should match different event types with actions", () => {
        const event = createRequestDecidedEvent("send_email");
        const result = eventMatchesFilter(event, {
          actions: ["send_email"],
        });
        expect(result).toBe(true);
      });
    });

    describe("urgency filtering", () => {
      it("should match when urgency is in filter", () => {
        const event = createRequestCreatedEvent("send_email", "critical");
        const result = eventMatchesFilter(event, {
          urgencies: ["high", "critical"],
        });
        expect(result).toBe(true);
      });

      it("should not match when urgency is not in filter", () => {
        const event = createRequestCreatedEvent("send_email", "low");
        const result = eventMatchesFilter(event, {
          urgencies: ["high", "critical"],
        });
        expect(result).toBe(false);
      });
    });

    describe("combined filtering", () => {
      it("should match when all filters pass", () => {
        const event = createRequestCreatedEvent("send_email", "high");
        const result = eventMatchesFilter(event, {
          types: [EventNames.REQUEST_CREATED],
          actions: ["send_email"],
          urgencies: ["high"],
        });
        expect(result).toBe(true);
      });

      it("should not match when one filter fails", () => {
        const event = createRequestCreatedEvent("send_email", "low");
        const result = eventMatchesFilter(event, {
          types: [EventNames.REQUEST_CREATED],
          actions: ["send_email"],
          urgencies: ["high"], // This will fail
        });
        expect(result).toBe(false);
      });
    });
  });

  describe("event types", () => {
    it("should type check RequestCreatedEvent correctly", () => {
      const event: RequestCreatedEvent = {
        type: EventNames.REQUEST_CREATED,
        timestamp: Date.now(),
        eventId: "evt_test",
        source: "test",
        payload: {
          requestId: "req_123",
          action: "send_email",
          params: { to: "user@example.com" },
          context: { userId: "user_1" },
          urgency: "normal",
        },
      };

      expect(event.type).toBe("request.created");
      expect(event.payload.requestId).toBe("req_123");
    });

    it("should type check RequestDecidedEvent correctly", () => {
      const event: RequestDecidedEvent = {
        type: EventNames.REQUEST_DECIDED,
        timestamp: Date.now(),
        eventId: "evt_test",
        source: "test",
        payload: {
          requestId: "req_123",
          action: "send_email",
          status: "approved",
          decidedBy: "user_1",
          decidedByType: "human",
          reason: "Looks good",
          decisionTimeMs: 5000,
        },
      };

      expect(event.type).toBe("request.decided");
      expect(event.payload.status).toBe("approved");
    });

    it("should work with AgentGateEvent union type", () => {
      const events: AgentGateEvent[] = [
        {
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
        },
        {
          type: EventNames.REQUEST_DECIDED,
          timestamp: Date.now(),
          eventId: "evt_2",
          source: "test",
          payload: {
            requestId: "req_1",
            action: "send_email",
            status: "approved",
            decidedBy: "user_1",
            decidedByType: "human",
            decisionTimeMs: 1000,
          },
        },
      ];

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("request.created");
      expect(events[1].type).toBe("request.decided");
    });
  });
});
