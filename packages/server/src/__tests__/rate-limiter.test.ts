/**
 * Tests for RateLimiter interface implementations
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  InMemoryRateLimiter,
  RedisRateLimiter,
  createRateLimiter,
  type RateLimiter,
} from "../lib/rate-limiter/index.js";

// Test both implementations with the same test suite
describe.each([
  { name: "InMemoryRateLimiter", factory: () => new InMemoryRateLimiter() },
])("$name", ({ factory }) => {
  let limiter: RateLimiter;

  beforeEach(async () => {
    limiter = factory();
    await limiter.clearAll();
  });

  afterAll(async () => {
    await limiter.shutdown();
  });

  describe("checkLimit", () => {
    it("should allow unlimited requests when limit is null", async () => {
      for (let i = 0; i < 100; i++) {
        const result = await limiter.checkLimit("test-key", null);
        expect(result.allowed).toBe(true);
        expect(result.limit).toBe(0);
      }
    });

    it("should allow unlimited requests when limit is 0", async () => {
      for (let i = 0; i < 100; i++) {
        const result = await limiter.checkLimit("test-key", 0);
        expect(result.allowed).toBe(true);
      }
    });

    it("should allow requests up to the limit", async () => {
      const limit = 5;

      for (let i = 0; i < limit; i++) {
        const result = await limiter.checkLimit("test-key", limit);
        expect(result.allowed).toBe(true);
        expect(result.limit).toBe(limit);
        expect(result.remaining).toBe(limit - i - 1);
      }
    });

    it("should deny requests over the limit", async () => {
      const limit = 3;

      // Use up the limit
      for (let i = 0; i < limit; i++) {
        const result = await limiter.checkLimit("test-key", limit);
        expect(result.allowed).toBe(true);
      }

      // Next request should be denied
      const result = await limiter.checkLimit("test-key", limit);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.resetMs).toBeGreaterThan(0);
    });

    it("should track limits per key independently", async () => {
      const limit = 2;

      // Use up limit for key1
      await limiter.checkLimit("key1", limit);
      await limiter.checkLimit("key1", limit);

      // key1 should be limited
      const key1Result = await limiter.checkLimit("key1", limit);
      expect(key1Result.allowed).toBe(false);

      // key2 should still have quota
      const key2Result = await limiter.checkLimit("key2", limit);
      expect(key2Result.allowed).toBe(true);
      expect(key2Result.remaining).toBe(1);
    });

    it("should return reset time in milliseconds", async () => {
      const limit = 1;

      const result = await limiter.checkLimit("test-key", limit);
      expect(result.allowed).toBe(true);
      expect(result.resetMs).toBeGreaterThan(0);
      expect(result.resetMs).toBeLessThanOrEqual(60 * 1000);
    });
  });

  describe("reset", () => {
    it("should reset limit for a specific key", async () => {
      const limit = 1;

      // Use up the limit
      await limiter.checkLimit("test-key", limit);
      const blocked = await limiter.checkLimit("test-key", limit);
      expect(blocked.allowed).toBe(false);

      // Reset the key
      await limiter.reset("test-key");

      // Should be allowed again
      const afterReset = await limiter.checkLimit("test-key", limit);
      expect(afterReset.allowed).toBe(true);
    });

    it("should not affect other keys", async () => {
      const limit = 1;

      // Use up limits for both keys
      await limiter.checkLimit("key1", limit);
      await limiter.checkLimit("key2", limit);

      // Reset only key1
      await limiter.reset("key1");

      // key1 should be unblocked, key2 should still be blocked
      expect((await limiter.checkLimit("key1", limit)).allowed).toBe(true);
      expect((await limiter.checkLimit("key2", limit)).allowed).toBe(false);
    });
  });

  describe("clearAll", () => {
    it("should clear all rate limits", async () => {
      const limit = 1;

      // Use up limits for multiple keys
      await limiter.checkLimit("key1", limit);
      await limiter.checkLimit("key2", limit);
      await limiter.checkLimit("key3", limit);

      // All should be blocked
      expect((await limiter.checkLimit("key1", limit)).allowed).toBe(false);
      expect((await limiter.checkLimit("key2", limit)).allowed).toBe(false);
      expect((await limiter.checkLimit("key3", limit)).allowed).toBe(false);

      // Clear all
      await limiter.clearAll();

      // All should be unblocked
      expect((await limiter.checkLimit("key1", limit)).allowed).toBe(true);
      expect((await limiter.checkLimit("key2", limit)).allowed).toBe(true);
      expect((await limiter.checkLimit("key3", limit)).allowed).toBe(true);
    });
  });
});

describe("createRateLimiter", () => {
  it("should create InMemoryRateLimiter for memory backend", () => {
    const limiter = createRateLimiter("memory");
    expect(limiter).toBeInstanceOf(InMemoryRateLimiter);
  });

  it("should create InMemoryRateLimiter when redis backend has no URL", () => {
    // Mock console.warn
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    
    const limiter = createRateLimiter("redis");
    expect(limiter).toBeInstanceOf(InMemoryRateLimiter);
    
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("REDIS_URL not set")
    );
    warnSpy.mockRestore();
  });

  it("should create RedisRateLimiter for redis backend with URL", () => {
    const limiter = createRateLimiter("redis", "redis://localhost:6379");
    expect(limiter).toBeInstanceOf(RedisRateLimiter);
  });
});

describe("RedisRateLimiter", () => {
  describe("fallback behavior", () => {
    it("should fall back to in-memory when Redis is unavailable", async () => {
      // Use an invalid Redis URL to trigger fallback
      const limiter = new RedisRateLimiter("redis://invalid-host-xyz:6379");

      // Give it time to fail connection
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should still work using fallback
      const result = await limiter.checkLimit("test-key", 5);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(5);

      await limiter.shutdown();
    });

    it("should report Redis not connected when unavailable", async () => {
      const limiter = new RedisRateLimiter("redis://invalid-host-xyz:6379");

      // Give it time to fail connection
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(limiter.isRedisConnected()).toBe(false);

      await limiter.shutdown();
    });
  });
});

describe("RateLimiter interface compliance", () => {
  it("InMemoryRateLimiter implements all interface methods", () => {
    const limiter = new InMemoryRateLimiter();
    expect(typeof limiter.checkLimit).toBe("function");
    expect(typeof limiter.reset).toBe("function");
    expect(typeof limiter.clearAll).toBe("function");
    expect(typeof limiter.shutdown).toBe("function");
  });

  it("RedisRateLimiter implements all interface methods", () => {
    const limiter = new RedisRateLimiter("redis://localhost:6379");
    expect(typeof limiter.checkLimit).toBe("function");
    expect(typeof limiter.reset).toBe("function");
    expect(typeof limiter.clearAll).toBe("function");
    expect(typeof limiter.shutdown).toBe("function");
  });
});
