import { describe, it, expect, beforeEach, vi } from "vitest";

// Need to reset module state for each test
describe("Logger", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should create a logger with default level", async () => {
    const { getLogger } = await import("../lib/logger.js");
    const log = getLogger();
    expect(log).toBeDefined();
    expect(log.level).toBe("info");
  });

  it("should create a request child logger with correlation ID", async () => {
    const { createRequestLogger } = await import("../lib/logger.js");
    const child = createRequestLogger("test-req-123");
    expect(child).toBeDefined();
    // Child logger should have bindings with requestId
    const bindings = child.bindings();
    expect(bindings.requestId).toBe("test-req-123");
  });
});
