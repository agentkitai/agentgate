// @agentkitai/agentgate-server - Health endpoint tests

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import app from "../index.js";
import type { RateLimiter } from "../lib/rate-limiter/types.js";

describe("Health Check", () => {
  describe("Shallow health check", () => {
    it("GET /health returns 200 with status ok", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("ok");
      expect(json.timestamp).toBeDefined();
      // Should NOT have checks object in shallow mode
      expect(json.checks).toBeUndefined();
    });
  });

  describe("Deep health check", () => {
    it("GET /health?deep=true returns 200 with database check", async () => {
      const res = await app.request("/health?deep=true");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("ok");
      expect(json.timestamp).toBeDefined();
      expect(json.checks).toBeDefined();
      expect(json.checks.database).toBeDefined();
      expect(json.checks.database.status).toBe("healthy");
      expect(typeof json.checks.database.latencyMs).toBe("number");
    });

    it("GET /health?deep=true returns 503 when DB is down", async () => {
      // Mock getDb to throw
      const dbModule = await import("../db/index.js");
      const originalGetDb = dbModule.getDb;
      vi.spyOn(dbModule, "getDb").mockImplementation(() => {
        throw new Error("DB connection failed");
      });

      try {
        const res = await app.request("/health?deep=true");
        expect(res.status).toBe(503);
        const json = await res.json();
        expect(json.status).toBe("degraded");
        expect(json.checks.database.status).toBe("unhealthy");
        expect(json.checks.database.error).toContain("DB connection failed");
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("does not include redis check when backend is memory", async () => {
      const res = await app.request("/health?deep=true");
      const json = await res.json();
      // Default config uses memory backend, so no redis check
      expect(json.checks.redis).toBeUndefined();
    });

    it("includes healthy redis check when redis backend is configured", async () => {
      const configModule = await import("../config.js");
      const rateLimiterModule = await import("../lib/rate-limiter/index.js");

      const mockLimiter: RateLimiter = {
        checkLimit: vi.fn(),
        reset: vi.fn(),
        clearAll: vi.fn(),
        shutdown: vi.fn(),
        ping: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(configModule, "getConfig").mockReturnValue({
        ...configModule.getConfig(),
        rateLimitBackend: "redis" as const,
      });
      vi.spyOn(rateLimiterModule, "getRateLimiter").mockReturnValue(mockLimiter);

      try {
        const res = await app.request("/health?deep=true");
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.checks.redis).toBeDefined();
        expect(json.checks.redis.status).toBe("healthy");
        expect(typeof json.checks.redis.latencyMs).toBe("number");
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("returns 503 with unhealthy redis when ping fails", async () => {
      const configModule = await import("../config.js");
      const rateLimiterModule = await import("../lib/rate-limiter/index.js");

      const mockLimiter: RateLimiter = {
        checkLimit: vi.fn(),
        reset: vi.fn(),
        clearAll: vi.fn(),
        shutdown: vi.fn(),
        ping: vi.fn().mockResolvedValue(false),
      };

      vi.spyOn(configModule, "getConfig").mockReturnValue({
        ...configModule.getConfig(),
        rateLimitBackend: "redis" as const,
      });
      vi.spyOn(rateLimiterModule, "getRateLimiter").mockReturnValue(mockLimiter);

      try {
        const res = await app.request("/health?deep=true");
        expect(res.status).toBe(503);
        const json = await res.json();
        expect(json.status).toBe("degraded");
        expect(json.checks.redis.status).toBe("unhealthy");
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("returns 503 when redis ping throws", async () => {
      const configModule = await import("../config.js");
      const rateLimiterModule = await import("../lib/rate-limiter/index.js");

      const mockLimiter: RateLimiter = {
        checkLimit: vi.fn(),
        reset: vi.fn(),
        clearAll: vi.fn(),
        shutdown: vi.fn(),
        ping: vi.fn().mockRejectedValue(new Error("Connection refused")),
      };

      vi.spyOn(configModule, "getConfig").mockReturnValue({
        ...configModule.getConfig(),
        rateLimitBackend: "redis" as const,
      });
      vi.spyOn(rateLimiterModule, "getRateLimiter").mockReturnValue(mockLimiter);

      try {
        const res = await app.request("/health?deep=true");
        expect(res.status).toBe(503);
        const json = await res.json();
        expect(json.status).toBe("degraded");
        expect(json.checks.redis.status).toBe("unhealthy");
        expect(json.checks.redis.error).toContain("Connection refused");
      } finally {
        vi.restoreAllMocks();
      }
    });
  });
});
