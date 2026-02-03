/**
 * Server configuration module
 * All environment variables are validated and typed at startup
 */

import { z } from "zod";

// ============================================================================
// Schema Definitions
// ============================================================================

/**
 * Notification channel types supported by AgentGate
 */
export const NotificationChannelSchema = z.enum([
  "slack",
  "discord",
  "email",
  "webhook",
  "sms",
]);

export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

/**
 * Channel routing configuration
 * Maps event types to notification channels with optional filtering
 */
export const ChannelRouteSchema = z.object({
  /** Channel type (slack, discord, email, etc.) */
  channel: NotificationChannelSchema,
  /** Target identifier (channel ID, email address, webhook URL, etc.) */
  target: z.string(),
  /** Optional filter: only route events matching these event types */
  eventTypes: z.array(z.string()).optional(),
  /** Optional filter: only route events matching these actions */
  actions: z.array(z.string()).optional(),
  /** Optional filter: only route events with these urgency levels */
  urgencies: z.array(z.enum(["low", "normal", "high", "critical"])).optional(),
  /** Whether this route is enabled */
  enabled: z.boolean().default(true),
});

export type ChannelRoute = z.infer<typeof ChannelRouteSchema>;

/**
 * Main configuration schema
 */
export const ConfigSchema = z.object({
  // Server
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  host: z.string().default("0.0.0.0"),
  nodeEnv: z.enum(["development", "production", "test"]).default("development"),

  // Database
  /** Database dialect: sqlite (default) or postgres */
  dbDialect: z.enum(["sqlite", "postgres"]).default("sqlite"),
  /** Database URL. For SQLite: file path or :memory:. For PostgreSQL: connection string */
  databaseUrl: z.string().default("./data/agentgate.db"),

  // Security
  /** API key for admin operations (required in production) */
  adminApiKey: z.string().min(16).optional(),
  /** JWT secret for session tokens */
  jwtSecret: z.string().min(32).optional(),
  /** CORS allowed origins (comma-separated) */
  corsOrigins: z.string().default("*"),

  // Rate Limiting
  /** Requests per minute per API key */
  rateLimitRpm: z.coerce.number().int().min(0).default(60),
  /** Enable rate limiting */
  rateLimitEnabled: z
    .union([z.boolean(), z.string()])
    .transform((val) => {
      if (typeof val === "boolean") return val;
      return val.toLowerCase() === "true";
    })
    .default(true),
  /** Rate limit backend: memory or redis */
  rateLimitBackend: z.enum(["memory", "redis"]).default("memory"),
  /** Redis URL for rate limiting (required if backend is redis) */
  redisUrl: z.string().optional(),

  // Decision Tokens
  /** Decision token expiry in hours (default: 24) */
  decisionTokenExpiryHours: z.coerce.number().int().min(1).default(24),
  /** Base URL for decision links (e.g., https://gate.example.com) */
  decisionLinkBaseUrl: z.string().optional(),

  // Notifications
  /** Default timeout for requests in seconds */
  requestTimeoutSec: z.coerce.number().int().min(0).default(3600),
  /** Webhook timeout in milliseconds */
  webhookTimeoutMs: z.coerce.number().int().min(100).default(5000),
  /** Max webhook retry attempts */
  webhookMaxRetries: z.coerce.number().int().min(0).default(3),

  // Slack Integration
  slackBotToken: z.string().optional(),
  slackSigningSecret: z.string().optional(),
  slackDefaultChannel: z.string().optional(),

  // Discord Integration
  discordBotToken: z.string().optional(),
  discordDefaultChannel: z.string().optional(),

  // Email Integration
  smtpHost: z.string().optional(),
  smtpPort: z.coerce.number().int().optional(),
  smtpUser: z.string().optional(),
  smtpPass: z.string().optional(),
  smtpFrom: z.string().email().optional(),

  // Dashboard URL (for "View in Dashboard" links in notifications)
  dashboardUrl: z.string().url().optional(),

  // Channel Routing (JSON string)
  channelRoutes: z
    .string()
    .default("[]")
    .transform((val) => {
      if (!val) return [];
      try {
        return JSON.parse(val) as unknown[];
      } catch {
        return [];
      }
    })
    .pipe(z.array(ChannelRouteSchema)),

  // Logging
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  logFormat: z.enum(["json", "pretty"]).default("pretty"),
});

export type Config = z.infer<typeof ConfigSchema>;

// ============================================================================
// Environment Variable Mapping
// ============================================================================

/**
 * Maps environment variable names to config keys
 */
const ENV_MAP: Record<string, keyof z.infer<typeof ConfigSchema>> = {
  PORT: "port",
  HOST: "host",
  NODE_ENV: "nodeEnv",
  DB_DIALECT: "dbDialect",
  DATABASE_URL: "databaseUrl",
  ADMIN_API_KEY: "adminApiKey",
  JWT_SECRET: "jwtSecret",
  CORS_ORIGINS: "corsOrigins",
  RATE_LIMIT_RPM: "rateLimitRpm",
  RATE_LIMIT_ENABLED: "rateLimitEnabled",
  RATE_LIMIT_BACKEND: "rateLimitBackend",
  REDIS_URL: "redisUrl",
  DECISION_TOKEN_EXPIRY_HOURS: "decisionTokenExpiryHours",
  DECISION_LINK_BASE_URL: "decisionLinkBaseUrl",
  REQUEST_TIMEOUT_SEC: "requestTimeoutSec",
  WEBHOOK_TIMEOUT_MS: "webhookTimeoutMs",
  WEBHOOK_MAX_RETRIES: "webhookMaxRetries",
  SLACK_BOT_TOKEN: "slackBotToken",
  SLACK_SIGNING_SECRET: "slackSigningSecret",
  SLACK_DEFAULT_CHANNEL: "slackDefaultChannel",
  DISCORD_BOT_TOKEN: "discordBotToken",
  DISCORD_DEFAULT_CHANNEL: "discordDefaultChannel",
  SMTP_HOST: "smtpHost",
  SMTP_PORT: "smtpPort",
  SMTP_USER: "smtpUser",
  SMTP_PASS: "smtpPass",
  SMTP_FROM: "smtpFrom",
  DASHBOARD_URL: "dashboardUrl",
  CHANNEL_ROUTES: "channelRoutes",
  LOG_LEVEL: "logLevel",
  LOG_FORMAT: "logFormat",
};

// ============================================================================
// Config Loading Functions
// ============================================================================

/**
 * Load raw values from environment variables
 */
function loadFromEnv(): Record<string, unknown> {
  const raw: Record<string, unknown> = {};

  for (const [envKey, configKey] of Object.entries(ENV_MAP)) {
    const value = process.env[envKey];
    if (value !== undefined) {
      raw[configKey] = value;
    }
  }

  return raw;
}

/**
 * Parse and validate configuration
 * @throws {z.ZodError} if validation fails
 */
export function parseConfig(
  input: Record<string, unknown> = {}
): Config {
  return ConfigSchema.parse(input);
}

/**
 * Load configuration from environment variables
 * @throws {z.ZodError} if validation fails
 */
export function loadConfig(): Config {
  const envValues = loadFromEnv();
  return parseConfig(envValues);
}

/**
 * Safely load configuration, returning errors instead of throwing
 */
export function loadConfigSafe(): { config: Config | null; errors: string[] } {
  try {
    const config = loadConfig();
    return { config, errors: [] };
  } catch (err) {
    if (err instanceof z.ZodError) {
      const errors = err.issues.map(
        (e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`
      );
      return { config: null, errors };
    }
    return { config: null, errors: [(err as Error).message] };
  }
}

/**
 * Validate that required production settings are present
 */
export function validateProductionConfig(config: Config): string[] {
  const warnings: string[] = [];

  if (config.nodeEnv === "production") {
    if (!config.adminApiKey) {
      warnings.push("ADMIN_API_KEY is required in production");
    }
    if (!config.jwtSecret) {
      warnings.push("JWT_SECRET is recommended in production");
    }
    if (config.corsOrigins === "*") {
      warnings.push("CORS_ORIGINS should be restricted in production");
    }
  }

  return warnings;
}

// ============================================================================
// Singleton Config Instance
// ============================================================================

let _config: Config | null = null;

/**
 * Get the global config instance (lazy-loaded)
 */
export function getConfig(): Config {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

/**
 * Reset the global config (mainly for testing)
 */
export function resetConfig(): void {
  _config = null;
}

/**
 * Set the global config (mainly for testing)
 */
export function setConfig(config: Config): void {
  _config = config;
}
