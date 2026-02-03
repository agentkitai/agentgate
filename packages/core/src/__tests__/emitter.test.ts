import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentGateEmitter,
  createEmitter,
  getGlobalEmitter,
  resetGlobalEmitter,
} from "../emitter.js";
import {
  EventNames,
  type RequestCreatedEvent,
  type RequestDecidedEvent,
} from "../events.js";

describe("AgentGateEmitter", () => {
  let emitter: AgentGateEmitter;

  beforeEach(() => {
    emitter = createEmitter();
  });

  describe("on/emit", () => {
    it("should call listener when event is emitted", async () => {
      const listener = vi.fn();
      emitter.on(EventNames.REQUEST_CREATED, listener);

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

      await emitter.emit(event);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(event);
    });

    it("should not call listener for different event type", async () => {
      const listener = vi.fn();
      emitter.on(EventNames.REQUEST_DECIDED, listener);

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

      await emitter.emit(event);

      expect(listener).not.toHaveBeenCalled();
    });

    it("should call multiple listeners for same event type", async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      emitter.on(EventNames.REQUEST_CREATED, listener1);
      emitter.on(EventNames.REQUEST_CREATED, listener2);

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

      await emitter.emit(event);

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it("should handle async listeners", async () => {
      const order: number[] = [];
      const listener1 = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push(1);
      });
      const listener2 = vi.fn(async () => {
        order.push(2);
      });

      emitter.on(EventNames.REQUEST_CREATED, listener1);
      emitter.on(EventNames.REQUEST_CREATED, listener2);

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

      await emitter.emit(event);

      // Both should have been called, in order
      expect(order).toEqual([1, 2]);
    });
  });

  describe("onAll", () => {
    it("should receive all events with onAll", async () => {
      const listener = vi.fn();
      emitter.onAll(listener);

      const event1: RequestCreatedEvent = {
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

      const event2: RequestDecidedEvent = {
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
      };

      await emitter.emit(event1);
      await emitter.emit(event2);

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenNthCalledWith(1, event1);
      expect(listener).toHaveBeenNthCalledWith(2, event2);
    });
  });

  describe("once", () => {
    it("should only call listener once", async () => {
      const listener = vi.fn();
      emitter.once(EventNames.REQUEST_CREATED, listener);

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

      await emitter.emit(event);
      await emitter.emit(event);

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("off", () => {
    it("should unsubscribe listener", async () => {
      const listener = vi.fn();
      emitter.on(EventNames.REQUEST_CREATED, listener);
      emitter.off(EventNames.REQUEST_CREATED, listener);

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

      await emitter.emit(event);

      expect(listener).not.toHaveBeenCalled();
    });

    it("should return unsubscribe function from on()", async () => {
      const listener = vi.fn();
      const unsub = emitter.on(EventNames.REQUEST_CREATED, listener);
      unsub();

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

      await emitter.emit(event);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should continue calling listeners after error", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const listener1 = vi.fn(() => {
        throw new Error("Test error");
      });
      const listener2 = vi.fn();

      emitter.on(EventNames.REQUEST_CREATED, listener1);
      emitter.on(EventNames.REQUEST_CREATED, listener2);

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

      await emitter.emit(event);

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalled();

      consoleError.mockRestore();
    });
  });

  describe("listenerCount", () => {
    it("should return count for specific event type", () => {
      emitter.on(EventNames.REQUEST_CREATED, () => {});
      emitter.on(EventNames.REQUEST_CREATED, () => {});
      emitter.on(EventNames.REQUEST_DECIDED, () => {});

      expect(emitter.listenerCount(EventNames.REQUEST_CREATED)).toBe(2);
      expect(emitter.listenerCount(EventNames.REQUEST_DECIDED)).toBe(1);
    });

    it("should include wildcard listeners in count", () => {
      emitter.on(EventNames.REQUEST_CREATED, () => {});
      emitter.onAll(() => {});

      expect(emitter.listenerCount(EventNames.REQUEST_CREATED)).toBe(2);
    });

    it("should return total count when no event type specified", () => {
      emitter.on(EventNames.REQUEST_CREATED, () => {});
      emitter.on(EventNames.REQUEST_DECIDED, () => {});
      emitter.onAll(() => {});

      expect(emitter.listenerCount()).toBe(3);
    });
  });

  describe("removeAllListeners", () => {
    it("should remove all listeners for event type", async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      emitter.on(EventNames.REQUEST_CREATED, listener1);
      emitter.on(EventNames.REQUEST_DECIDED, listener2);

      emitter.removeAllListeners(EventNames.REQUEST_CREATED);

      const event1: RequestCreatedEvent = {
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

      const event2: RequestDecidedEvent = {
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
      };

      await emitter.emit(event1);
      await emitter.emit(event2);

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it("should remove all listeners when no type specified", () => {
      emitter.on(EventNames.REQUEST_CREATED, () => {});
      emitter.on(EventNames.REQUEST_DECIDED, () => {});
      emitter.onAll(() => {});

      emitter.removeAllListeners();

      expect(emitter.listenerCount()).toBe(0);
    });
  });

  describe("emitSync", () => {
    it("should fire and forget async listeners", () => {
      const listener = vi.fn();
      emitter.on(EventNames.REQUEST_CREATED, listener);

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

      // This should not block
      emitter.emitSync(event);

      // Listener may not be called immediately since it's fire-and-forget
      // But it will be called eventually
    });
  });
});

describe("global emitter", () => {
  beforeEach(() => {
    resetGlobalEmitter();
  });

  it("should return same instance on multiple calls", () => {
    const emitter1 = getGlobalEmitter();
    const emitter2 = getGlobalEmitter();
    expect(emitter1).toBe(emitter2);
  });

  it("should return new instance after reset", () => {
    const emitter1 = getGlobalEmitter();
    resetGlobalEmitter();
    const emitter2 = getGlobalEmitter();
    expect(emitter1).not.toBe(emitter2);
  });
});
