import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

    it("should parse hstsEnabled with various truthy values", () => {
      expect(parseConfig({ hstsEnabled: "true" }).hstsEnabled).toBe(true);
      expect(parseConfig({ hstsEnabled: "TRUE" }).hstsEnabled).toBe(true);
      expect(parseConfig({ hstsEnabled: "1" }).hstsEnabled).toBe(true);
      expect(parseConfig({ hstsEnabled: "yes" }).hstsEnabled).toBe(true);
      expect(parseConfig({ hstsEnabled: "Yes" }).hstsEnabled).toBe(true);
      expect(parseConfig({ hstsEnabled: "false" }).hstsEnabled).toBe(false);
      expect(parseConfig({ hstsEnabled: "0" }).hstsEnabled).toBe(false);
      expect(parseConfig({ hstsEnabled: "no" }).hstsEnabled).toBe(false);
      expect(parseConfig({}).hstsEnabled).toBe(false);
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

  describe("CORS allowed origins", () => {
    it("should return null for undefined", () => {
      const config = parseConfig({});
      expect(config.corsAllowedOrigins).toBeNull();
    });

    it("should return null for wildcard", () => {
      const config = parseConfig({ corsAllowedOrigins: "*" });
      expect(config.corsAllowedOrigins).toBeNull();
    });

    it("should parse single origin", () => {
      const config = parseConfig({ corsAllowedOrigins: "https://example.com" });
      expect(config.corsAllowedOrigins).toEqual(["https://example.com"]);
    });

    it("should parse comma-separated origins", () => {
      const config = parseConfig({
        corsAllowedOrigins: "https://example.com,https://admin.example.com",
      });
      expect(config.corsAllowedOrigins).toEqual([
        "https://example.com",
        "https://admin.example.com",
      ]);
    });

    it("should trim whitespace from origins", () => {
      const config = parseConfig({
        corsAllowedOrigins: " https://example.com , https://admin.example.com ",
      });
      expect(config.corsAllowedOrigins).toEqual([
        "https://example.com",
        "https://admin.example.com",
      ]);
    });

    it("should filter empty strings", () => {
      const config = parseConfig({
        corsAllowedOrigins: "https://example.com,,https://admin.example.com,",
      });
      expect(config.corsAllowedOrigins).toEqual([
        "https://example.com",
        "https://admin.example.com",
      ]);
    });

    it("should load from CORS_ALLOWED_ORIGINS env var", () => {
      process.env.CORS_ALLOWED_ORIGINS = "https://myapp.com";
      const config = loadConfig();
      expect(config.corsAllowedOrigins).toEqual(["https://myapp.com"]);
    });
  });

  describe("environment helpers", () => {
    it("should set isDevelopment true in development", () => {
      const config = parseConfig({ nodeEnv: "development" });
      expect(config.isDevelopment).toBe(true);
      expect(config.isProduction).toBe(false);
    });

    it("should set isProduction true in production", () => {
      const config = parseConfig({ nodeEnv: "production" });
      expect(config.isDevelopment).toBe(false);
      expect(config.isProduction).toBe(true);
    });

    it("should set both false in test", () => {
      const config = parseConfig({ nodeEnv: "test" });
      expect(config.isDevelopment).toBe(false);
      expect(config.isProduction).toBe(false);
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

    it("should warn about missing JWT_SECRET in production", () => {
      const config = parseConfig({
        nodeEnv: "production",
        adminApiKey: "supersecretadminkey123",
      });

      const warnings = validateProductionConfig(config);
      expect(warnings).toContain("JWT_SECRET is required in production");
    });

    it("should warn about missing CORS origins in production", () => {
      const config = parseConfig({
        nodeEnv: "production",
        adminApiKey: "supersecretadminkey123",
        jwtSecret: "a-very-long-jwt-secret-at-least-32-chars",
      });

      const warnings = validateProductionConfig(config);
      expect(warnings).toContain(
        "CORS_ALLOWED_ORIGINS should be set in production"
      );
    });

    it("should return no warnings for well-configured production", () => {
      const config = parseConfig({
        nodeEnv: "production",
        adminApiKey: "supersecretadminkey123",
        jwtSecret: "a-very-long-jwt-secret-at-least-32-chars",
        corsAllowedOrigins: "https://example.com",
        webhookEncryptionKey: "my-encryption-key",
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

    it("should produce critical warnings that startup logic can filter", () => {
      const config = parseConfig({ nodeEnv: "production" });
      const warnings = validateProductionConfig(config);
      const criticalWarnings = warnings.filter(
        (w) => w.includes("ADMIN_API_KEY") || w.includes("JWT_SECRET")
      );
      expect(criticalWarnings.length).toBeGreaterThan(0);
      expect(criticalWarnings.some((w) => w.includes("ADMIN_API_KEY"))).toBe(true);
      expect(criticalWarnings.some((w) => w.includes("JWT_SECRET"))).toBe(true);
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

  describe("file-based secrets (_FILE suffix)", () => {
    const secretDir = join(tmpdir(), "agentgate-test-secrets");

    beforeEach(() => {
      mkdirSync(secretDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(secretDir, { recursive: true, force: true });
      // Clean up all _FILE env vars
      for (const key of [
        "ADMIN_API_KEY_FILE",
        "JWT_SECRET_FILE",
        "DATABASE_URL_FILE",
        "REDIS_URL_FILE",
        "SLACK_BOT_TOKEN_FILE",
        "SLACK_SIGNING_SECRET_FILE",
        "DISCORD_BOT_TOKEN_FILE",
        "SMTP_PASS_FILE",
        "WEBHOOK_ENCRYPTION_KEY_FILE",
      ]) {
        delete process.env[key];
      }
    });

    it("should read ADMIN_API_KEY from file when _FILE is set", () => {
      const secretFile = join(secretDir, "admin-key");
      writeFileSync(secretFile, "my-secret-admin-key-1234\n");
      process.env.ADMIN_API_KEY_FILE = secretFile;
      delete process.env.ADMIN_API_KEY;

      const config = loadConfig();
      expect(config.adminApiKey).toBe("my-secret-admin-key-1234");
    });

    it("should trim whitespace/newlines from secret files", () => {
      const secretFile = join(secretDir, "jwt-secret");
      writeFileSync(secretFile, "  jwt-secret-value-that-is-at-least-32-chars!!  \n\n");
      process.env.JWT_SECRET_FILE = secretFile;
      delete process.env.JWT_SECRET;

      const config = loadConfig();
      expect(config.jwtSecret).toBe("jwt-secret-value-that-is-at-least-32-chars!!");
    });

    it("should prefer env var over _FILE when both are set", () => {
      const secretFile = join(secretDir, "admin-key");
      writeFileSync(secretFile, "from-file-secret-key!");
      process.env.ADMIN_API_KEY_FILE = secretFile;
      process.env.ADMIN_API_KEY = "from-env-secret-key!";

      const config = loadConfig();
      expect(config.adminApiKey).toBe("from-env-secret-key!");
    });

    it("should handle missing secret file gracefully", () => {
      process.env.ADMIN_API_KEY_FILE = join(secretDir, "nonexistent");
      delete process.env.ADMIN_API_KEY;

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const config = loadConfig();
      expect(config.adminApiKey).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Warning: Could not read secret file for ADMIN_API_KEY_FILE")
      );
      consoleSpy.mockRestore();
    });

    it("should resolve DATABASE_URL from file", () => {
      const secretFile = join(secretDir, "db-url");
      writeFileSync(secretFile, "postgresql://user:pass@host:5432/db\n");
      process.env.DATABASE_URL_FILE = secretFile;
      delete process.env.DATABASE_URL;

      const config = loadConfig();
      expect(config.databaseUrl).toBe("postgresql://user:pass@host:5432/db");
    });

    it("should resolve SMTP_PASS from file", () => {
      const secretFile = join(secretDir, "smtp-pass");
      writeFileSync(secretFile, "smtp-password-123\n");
      process.env.SMTP_PASS_FILE = secretFile;
      delete process.env.SMTP_PASS;

      const config = loadConfig();
      expect(config.smtpPass).toBe("smtp-password-123");
    });
  });

  describe("integration", () => {
    it("should support full configuration scenario", () => {
      process.env.PORT = "8080";
      process.env.NODE_ENV = "production";
      process.env.DATABASE_URL = "/var/data/agentgate.db";
      process.env.ADMIN_API_KEY = "production-admin-key-1234";
      process.env.JWT_SECRET = "production-jwt-secret-must-be-32-chars!";
      process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com,https://admin.example.com";
      process.env.RATE_LIMIT_RPM = "100";
      process.env.WEBHOOK_TIMEOUT_MS = "10000";
      process.env.SLACK_BOT_TOKEN = "xoxb-prod-token";
      process.env.LOG_LEVEL = "warn";
      process.env.WEBHOOK_ENCRYPTION_KEY = "prod-encryption-key";
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
