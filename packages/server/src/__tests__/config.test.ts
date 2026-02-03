import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseConfig,
  loadConfig,
  loadConfigSafe,
  validateProductionConfig,
  getConfig,
  resetConfig,
  setConfig,
} from "../config.js";

describe("config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset config singleton
    resetConfig();
    // Clone env to restore later
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
  });

  describe("parseConfig", () => {
    it("should use defaults when no values provided", () => {
      const config = parseConfig({});

      expect(config.port).toBe(3000);
      expect(config.host).toBe("0.0.0.0");
      expect(config.nodeEnv).toBe("development");
      expect(config.databaseUrl).toBe("./data/agentgate.db");
      expect(config.rateLimitRpm).toBe(60);
      expect(config.rateLimitEnabled).toBe(true);
      expect(config.logLevel).toBe("info");
    });

    it("should parse port as number", () => {
      const config = parseConfig({ port: "8080" });
      expect(config.port).toBe(8080);
    });

    it("should reject invalid port", () => {
      expect(() => parseConfig({ port: "99999" })).toThrow();
      expect(() => parseConfig({ port: "0" })).toThrow();
      expect(() => parseConfig({ port: "abc" })).toThrow();
    });

    it("should parse boolean rate limit enabled", () => {
      expect(parseConfig({ rateLimitEnabled: "true" }).rateLimitEnabled).toBe(
        true
      );
      expect(parseConfig({ rateLimitEnabled: "false" }).rateLimitEnabled).toBe(
        false
      );
      expect(parseConfig({ rateLimitEnabled: true }).rateLimitEnabled).toBe(
        true
      );
    });

    it("should validate node env", () => {
      expect(parseConfig({ nodeEnv: "production" }).nodeEnv).toBe("production");
      expect(parseConfig({ nodeEnv: "test" }).nodeEnv).toBe("test");
      expect(() => parseConfig({ nodeEnv: "invalid" })).toThrow();
    });

    it("should validate log level", () => {
      expect(parseConfig({ logLevel: "debug" }).logLevel).toBe("debug");
      expect(parseConfig({ logLevel: "error" }).logLevel).toBe("error");
      expect(() => parseConfig({ logLevel: "verbose" })).toThrow();
    });
  });

  describe("channel routes", () => {
    it("should parse empty channel routes", () => {
      const config = parseConfig({ channelRoutes: "[]" });
      expect(config.channelRoutes).toEqual([]);
    });

    it("should parse channel routes JSON", () => {
      const routes: ChannelRoute[] = [
        {
          channel: "slack",
          target: "#alerts",
          enabled: true,
        },
        {
          channel: "email",
          target: "admin@example.com",
          actions: ["send_email"],
          urgencies: ["critical"],
          enabled: true,
        },
      ];

      const config = parseConfig({ channelRoutes: JSON.stringify(routes) });
      expect(config.channelRoutes).toHaveLength(2);
      expect(config.channelRoutes[0].channel).toBe("slack");
      expect(config.channelRoutes[1].actions).toEqual(["send_email"]);
    });

    it("should validate channel types", () => {
      const invalidRoutes = [{ channel: "invalid_channel", target: "test" }];
      expect(() =>
        parseConfig({ channelRoutes: JSON.stringify(invalidRoutes) })
      ).toThrow();
    });

    it("should handle invalid JSON gracefully", () => {
      const config = parseConfig({ channelRoutes: "not-json" });
      expect(config.channelRoutes).toEqual([]);
    });

    it("should validate urgency values in routes", () => {
      const routes = [
        {
          channel: "slack",
          target: "#test",
          urgencies: ["invalid_urgency"],
        },
      ];
      expect(() =>
        parseConfig({ channelRoutes: JSON.stringify(routes) })
      ).toThrow();
    });
  });

  describe("loadConfig", () => {
    it("should load from environment variables", () => {
      process.env.PORT = "4000";
      process.env.NODE_ENV = "production";
      process.env.LOG_LEVEL = "debug";
      process.env.RATE_LIMIT_RPM = "120";

      const config = loadConfig();

      expect(config.port).toBe(4000);
      expect(config.nodeEnv).toBe("production");
      expect(config.logLevel).toBe("debug");
      expect(config.rateLimitRpm).toBe(120);
    });

    it("should load database URL from env", () => {
      process.env.DATABASE_URL = ":memory:";
      const config = loadConfig();
      expect(config.databaseUrl).toBe(":memory:");
    });

    it("should load Slack configuration", () => {
      process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
      process.env.SLACK_SIGNING_SECRET = "secret123";
      process.env.SLACK_DEFAULT_CHANNEL = "#general";

      const config = loadConfig();

      expect(config.slackBotToken).toBe("xoxb-test-token");
      expect(config.slackSigningSecret).toBe("secret123");
      expect(config.slackDefaultChannel).toBe("#general");
    });
  });

  describe("loadConfigSafe", () => {
    it("should return config on success", () => {
      const result = loadConfigSafe();
      expect(result.config).not.toBeNull();
      expect(result.errors).toHaveLength(0);
    });

    it("should return errors on failure", () => {
      process.env.PORT = "invalid";
      const result = loadConfigSafe();
      expect(result.config).toBeNull();
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("validateProductionConfig", () => {
    it("should warn about missing admin API key in production", () => {
      const config = parseConfig({
        nodeEnv: "production",
      });

      const warnings = validateProductionConfig(config);
      expect(warnings).toContain("ADMIN_API_KEY is required in production");
    });

    it("should warn about wildcard CORS in production", () => {
      const config = parseConfig({
        nodeEnv: "production",
        adminApiKey: "supersecretadminkey123",
      });

      const warnings = validateProductionConfig(config);
      expect(warnings).toContain(
        "CORS_ORIGINS should be restricted in production"
      );
    });

    it("should return no warnings for well-configured production", () => {
      const config = parseConfig({
        nodeEnv: "production",
        adminApiKey: "supersecretadminkey123",
        jwtSecret: "a-very-long-jwt-secret-at-least-32-chars",
        corsOrigins: "https://example.com",
      });

      const warnings = validateProductionConfig(config);
      expect(warnings).toHaveLength(0);
    });

    it("should not warn in development mode", () => {
      const config = parseConfig({
        nodeEnv: "development",
      });

      const warnings = validateProductionConfig(config);
      expect(warnings).toHaveLength(0);
    });
  });

  describe("singleton", () => {
    it("should cache config on first access", () => {
      process.env.PORT = "5000";
      const config1 = getConfig();
      expect(config1.port).toBe(5000);

      // Change env - should still return cached value
      process.env.PORT = "6000";
      const config2 = getConfig();
      expect(config2.port).toBe(5000);
      expect(config1).toBe(config2);
    });

    it("should reset cache", () => {
      process.env.PORT = "5000";
      getConfig();

      resetConfig();
      process.env.PORT = "7000";
      const config = getConfig();
      expect(config.port).toBe(7000);
    });

    it("should allow manual config injection", () => {
      const testConfig = parseConfig({ port: 9999 });
      setConfig(testConfig);

      const config = getConfig();
      expect(config.port).toBe(9999);
    });
  });

  describe("integration", () => {
    it("should support full configuration scenario", () => {
      process.env.PORT = "8080";
      process.env.NODE_ENV = "production";
      process.env.DATABASE_URL = "/var/data/agentgate.db";
      process.env.ADMIN_API_KEY = "production-admin-key-1234";
      process.env.JWT_SECRET = "production-jwt-secret-must-be-32-chars!";
      process.env.CORS_ORIGINS = "https://app.example.com";
      process.env.RATE_LIMIT_RPM = "100";
      process.env.WEBHOOK_TIMEOUT_MS = "10000";
      process.env.SLACK_BOT_TOKEN = "xoxb-prod-token";
      process.env.LOG_LEVEL = "warn";
      process.env.CHANNEL_ROUTES = JSON.stringify([
        { channel: "slack", target: "#prod-alerts", enabled: true },
        {
          channel: "email",
          target: "ops@example.com",
          urgencies: ["critical"],
          enabled: true,
        },
      ]);

      const config = loadConfig();

      expect(config.port).toBe(8080);
      expect(config.nodeEnv).toBe("production");
      expect(config.databaseUrl).toBe("/var/data/agentgate.db");
      expect(config.rateLimitRpm).toBe(100);
      expect(config.webhookTimeoutMs).toBe(10000);
      expect(config.channelRoutes).toHaveLength(2);
      expect(config.logLevel).toBe("warn");

      const warnings = validateProductionConfig(config);
      expect(warnings).toHaveLength(0);
    });
  });
});
