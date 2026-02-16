import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseConfig,
  loadConfig,
  loadConfigSafe,
  validateProductionConfig,
  getConfig,
  resetConfig,
  setConfig,
  ConfigSchema,
} from "../config.js";

describe("config edge cases", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetConfig();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
  });

  describe("parseConfig edge cases", () => {
    it("should coerce negative port to throw", () => {
      expect(() => parseConfig({ port: "-1" })).toThrow();
    });

    it("should handle port at exact boundaries", () => {
      expect(parseConfig({ port: "1" }).port).toBe(1);
      expect(parseConfig({ port: "65535" }).port).toBe(65535);
    });

    it("should reject floating point port", () => {
      expect(() => parseConfig({ port: "8080.5" })).toThrow();
    });

    it("should handle rate limit rpm of 0", () => {
      const config = parseConfig({ rateLimitRpm: "0" });
      expect(config.rateLimitRpm).toBe(0);
    });

    it("should reject negative rate limit rpm", () => {
      expect(() => parseConfig({ rateLimitRpm: "-10" })).toThrow();
    });

    it("should parse rateLimitEnabled with uppercase TRUE", () => {
      expect(parseConfig({ rateLimitEnabled: "TRUE" }).rateLimitEnabled).toBe(true);
    });

    it("should parse rateLimitEnabled with mixed case False", () => {
      expect(parseConfig({ rateLimitEnabled: "FaLsE" }).rateLimitEnabled).toBe(false);
    });

    it("should treat non-true string as false for rateLimitEnabled", () => {
      expect(parseConfig({ rateLimitEnabled: "yes" }).rateLimitEnabled).toBe(false);
      expect(parseConfig({ rateLimitEnabled: "1" }).rateLimitEnabled).toBe(false);
    });

    it("should validate database dialect", () => {
      expect(parseConfig({ dbDialect: "sqlite" }).dbDialect).toBe("sqlite");
      expect(parseConfig({ dbDialect: "postgres" }).dbDialect).toBe("postgres");
      expect(() => parseConfig({ dbDialect: "mysql" })).toThrow();
    });

    it("should validate rate limit backend", () => {
      expect(parseConfig({ rateLimitBackend: "memory" }).rateLimitBackend).toBe("memory");
      expect(parseConfig({ rateLimitBackend: "redis" }).rateLimitBackend).toBe("redis");
      expect(() => parseConfig({ rateLimitBackend: "memcached" })).toThrow();
    });

    it("should validate log format", () => {
      expect(parseConfig({ logFormat: "json" }).logFormat).toBe("json");
      expect(parseConfig({ logFormat: "pretty" }).logFormat).toBe("pretty");
      expect(() => parseConfig({ logFormat: "text" })).toThrow();
    });

    it("should reject admin API key shorter than 16 chars", () => {
      expect(() => parseConfig({ adminApiKey: "short" })).toThrow();
    });

    it("should accept admin API key of exactly 16 chars", () => {
      const config = parseConfig({ adminApiKey: "1234567890123456" });
      expect(config.adminApiKey).toBe("1234567890123456");
    });

    it("should reject JWT secret shorter than 32 chars", () => {
      expect(() => parseConfig({ jwtSecret: "short-secret" })).toThrow();
    });

    it("should accept JWT secret of exactly 32 chars", () => {
      const secret = "12345678901234567890123456789012";
      const config = parseConfig({ jwtSecret: secret });
      expect(config.jwtSecret).toBe(secret);
    });

    it("should handle empty string for optional fields", () => {
      // Empty strings should be parsed as-is for optional string fields
      const config = parseConfig({});
      expect(config.slackBotToken).toBeUndefined();
      expect(config.discordBotToken).toBeUndefined();
    });

    it("should validate SMTP from as email", () => {
      expect(parseConfig({ smtpFrom: "test@example.com" }).smtpFrom).toBe("test@example.com");
      expect(() => parseConfig({ smtpFrom: "not-an-email" })).toThrow();
    });

    it("should validate dashboard URL as URL", () => {
      expect(parseConfig({ dashboardUrl: "https://example.com" }).dashboardUrl).toBe("https://example.com");
      expect(() => parseConfig({ dashboardUrl: "not-a-url" })).toThrow();
    });

    it("should coerce numeric fields from strings", () => {
      const config = parseConfig({
        webhookTimeoutMs: "10000",
        webhookMaxRetries: "5",
        requestTimeoutSec: "7200",
        decisionTokenExpiryHours: "48",
        smtpPort: "465",
      });
      expect(config.webhookTimeoutMs).toBe(10000);
      expect(config.webhookMaxRetries).toBe(5);
      expect(config.requestTimeoutSec).toBe(7200);
      expect(config.decisionTokenExpiryHours).toBe(48);
      expect(config.smtpPort).toBe(465);
    });

    it("should reject webhook timeout below minimum", () => {
      expect(() => parseConfig({ webhookTimeoutMs: "50" })).toThrow();
    });

    it("should accept webhook timeout at minimum", () => {
      expect(parseConfig({ webhookTimeoutMs: "100" }).webhookTimeoutMs).toBe(100);
    });

    it("should reject negative webhook max retries", () => {
      expect(() => parseConfig({ webhookMaxRetries: "-1" })).toThrow();
    });

    it("should accept zero webhook max retries", () => {
      expect(parseConfig({ webhookMaxRetries: "0" }).webhookMaxRetries).toBe(0);
    });

    it("should reject decision token expiry less than 1 hour", () => {
      expect(() => parseConfig({ decisionTokenExpiryHours: "0" })).toThrow();
    });

    it("should accept decision token expiry of exactly 1 hour", () => {
      expect(parseConfig({ decisionTokenExpiryHours: "1" }).decisionTokenExpiryHours).toBe(1);
    });
  });

  describe("channel routes edge cases", () => {
    it("should parse route with all filters", () => {
      const routes = [{
        channel: "slack",
        target: "#alerts",
        eventTypes: ["request.created", "request.decided"],
        actions: ["send_email", "delete_file"],
        urgencies: ["high", "critical"],
        enabled: true,
      }];
      const config = parseConfig({ channelRoutes: JSON.stringify(routes) });
      expect(config.channelRoutes[0].eventTypes).toEqual(["request.created", "request.decided"]);
      expect(config.channelRoutes[0].actions).toEqual(["send_email", "delete_file"]);
      expect(config.channelRoutes[0].urgencies).toEqual(["high", "critical"]);
    });

    it("should default enabled to true when not specified", () => {
      const routes = [{ channel: "slack", target: "#test" }];
      const config = parseConfig({ channelRoutes: JSON.stringify(routes) });
      expect(config.channelRoutes[0].enabled).toBe(true);
    });

    it("should parse explicitly disabled route", () => {
      const routes = [{ channel: "email", target: "test@example.com", enabled: false }];
      const config = parseConfig({ channelRoutes: JSON.stringify(routes) });
      expect(config.channelRoutes[0].enabled).toBe(false);
    });

    it("should validate all urgency values", () => {
      const validUrgencies = ["low", "normal", "high", "critical"];
      for (const urgency of validUrgencies) {
        const routes = [{ channel: "slack", target: "#test", urgencies: [urgency] }];
        const config = parseConfig({ channelRoutes: JSON.stringify(routes) });
        expect(config.channelRoutes[0].urgencies).toEqual([urgency]);
      }
    });

    it("should validate all channel types", () => {
      const validChannels = ["slack", "discord", "email", "webhook", "sms"];
      for (const channel of validChannels) {
        const routes = [{ channel, target: "test" }];
        const config = parseConfig({ channelRoutes: JSON.stringify(routes) });
        expect(config.channelRoutes[0].channel).toBe(channel);
      }
    });

    it("should handle null channelRoutes", () => {
      // When channelRoutes is explicitly null in env
      const config = parseConfig({ channelRoutes: "" });
      expect(config.channelRoutes).toEqual([]);
    });

    it("should handle array with empty objects gracefully", () => {
      expect(() => parseConfig({ channelRoutes: "[{}]" })).toThrow();
    });

    it("should handle deeply nested invalid JSON", () => {
      const config = parseConfig({ channelRoutes: "{{invalid}}" });
      expect(config.channelRoutes).toEqual([]);
    });
  });

  describe("loadConfigSafe edge cases", () => {
    it("should capture multiple validation errors", () => {
      process.env.PORT = "invalid";
      process.env.NODE_ENV = "invalid-env";
      const result = loadConfigSafe();
      expect(result.config).toBeNull();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should handle non-ZodError exceptions", () => {
      // Mock an unusual error scenario
      const originalEnvValue = process.env.PORT;
      Object.defineProperty(process.env, "PORT", {
        get() {
          throw new Error("Unexpected access error");
        },
        configurable: true,
      });

      const result = loadConfigSafe();
      expect(result.config).toBeNull();
      expect(result.errors).toContain("Unexpected access error");

      // Restore
      Object.defineProperty(process.env, "PORT", {
        value: originalEnvValue,
        writable: true,
        configurable: true,
      });
    });
  });

  describe("validateProductionConfig edge cases", () => {
    it("should warn about missing JWT secret in production", () => {
      const config = parseConfig({
        nodeEnv: "production",
        adminApiKey: "supersecretadminkey123",
      });
      const warnings = validateProductionConfig(config);
      expect(warnings).toContain("JWT_SECRET is required in production");
    });

    it("should not warn when all production settings are correct", () => {
      const config = parseConfig({
        nodeEnv: "production",
        adminApiKey: "supersecretadminkey123",
        jwtSecret: "very-long-jwt-secret-that-is-32-chars!!",
        corsAllowedOrigins: "https://myapp.com,https://admin.myapp.com",
        webhookEncryptionKey: "my-encryption-key",
        authMode: "api-key-only",
      });
      const warnings = validateProductionConfig(config);
      expect(warnings).toHaveLength(0);
    });

    it("should not warn in test mode", () => {
      const config = parseConfig({
        nodeEnv: "test",
      });
      const warnings = validateProductionConfig(config);
      expect(warnings).toHaveLength(0);
    });
  });

  describe("singleton behavior edge cases", () => {
    it("should preserve config across multiple getConfig calls", () => {
      process.env.PORT = "5555";
      const config1 = getConfig();
      const config2 = getConfig();
      const config3 = getConfig();
      expect(config1).toBe(config2);
      expect(config2).toBe(config3);
      expect(config1.port).toBe(5555);
    });

    it("should allow setConfig to override with completely different config", () => {
      process.env.PORT = "5000";
      getConfig(); // Initialize with port 5000

      const customConfig = parseConfig({
        port: 9000,
        nodeEnv: "production",
        logLevel: "error",
      });
      setConfig(customConfig);

      const retrieved = getConfig();
      expect(retrieved.port).toBe(9000);
      expect(retrieved.nodeEnv).toBe("production");
      expect(retrieved.logLevel).toBe("error");
    });

    it("should properly reset and reinitialize", () => {
      process.env.PORT = "3000";
      getConfig();

      resetConfig();
      process.env.PORT = "4000";
      expect(getConfig().port).toBe(4000);

      resetConfig();
      process.env.PORT = "5000";
      expect(getConfig().port).toBe(5000);
    });
  });

  describe("environment variable mapping edge cases", () => {
    it("should load all Discord configuration", () => {
      process.env.DISCORD_BOT_TOKEN = "discord-token-123";
      process.env.DISCORD_DEFAULT_CHANNEL = "123456789";
      const config = loadConfig();
      expect(config.discordBotToken).toBe("discord-token-123");
      expect(config.discordDefaultChannel).toBe("123456789");
    });

    it("should load Redis URL configuration", () => {
      process.env.RATE_LIMIT_BACKEND = "redis";
      process.env.REDIS_URL = "redis://localhost:6379";
      const config = loadConfig();
      expect(config.rateLimitBackend).toBe("redis");
      expect(config.redisUrl).toBe("redis://localhost:6379");
    });

    it("should load decision link base URL", () => {
      process.env.DECISION_LINK_BASE_URL = "https://gate.example.com";
      const config = loadConfig();
      expect(config.decisionLinkBaseUrl).toBe("https://gate.example.com");
    });

    it("should load all SMTP configuration", () => {
      process.env.SMTP_HOST = "smtp.example.com";
      process.env.SMTP_PORT = "587";
      process.env.SMTP_USER = "user@example.com";
      process.env.SMTP_PASS = "password123";
      process.env.SMTP_FROM = "noreply@example.com";
      const config = loadConfig();
      expect(config.smtpHost).toBe("smtp.example.com");
      expect(config.smtpPort).toBe(587);
      expect(config.smtpUser).toBe("user@example.com");
      expect(config.smtpPass).toBe("password123");
      expect(config.smtpFrom).toBe("noreply@example.com");
    });

    it("should ignore undefined environment variables", () => {
      delete process.env.SLACK_BOT_TOKEN;
      delete process.env.DISCORD_BOT_TOKEN;
      const config = loadConfig();
      expect(config.slackBotToken).toBeUndefined();
      expect(config.discordBotToken).toBeUndefined();
    });
  });
});
