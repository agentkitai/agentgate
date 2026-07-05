/**
 * Server configuration module
 * All environment variables are validated and typed at startup
 */

import { readFileSync } from "node:fs";
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
  /** CORS allowed origins (comma-separated). Empty or "*" = allow all in dev, deny in prod */
  corsAllowedOrigins: z
    .string()
    .optional()
    .transform((val) => {
      if (!val || val === "*") return null; // null means use default behavior
      return val.split(",").map((origin) => origin.trim()).filter(Boolean);
    }),

  /** Enable HSTS header (opt-in, default false) */
  hstsEnabled: z
    .union([z.boolean(), z.string()])
    .transform((val) => {
      if (typeof val === "boolean") return val;
      return ["true", "1", "yes"].includes(val.toLowerCase());
    })
    .default(false),

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
  /** DEV/TEST ONLY — permit webhook destinations on loopback / RFC-1918 private
   *  ranges (127.0.0.1, ::1, 10.x, 172.16-31.x, 192.168.x, localhost). Lets local
   *  integrations (e.g. the AgentGate×UCP adapter demo) register a
   *  http://127.0.0.1:PORT webhook without the SSRF guard rejecting it. Cloud
   *  metadata endpoints and non-HTTP(S) protocols STAY blocked. Default off —
   *  never enable in production. */
  allowPrivateWebhooks: z
    .union([z.boolean(), z.string()])
    .transform((val) => (typeof val === "boolean" ? val : ["true", "1", "yes"].includes(val.toLowerCase())))
    .default(false),

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

  // Channel Failover
  /** Fallback channel chains (JSON string, e.g. {"slack":["email","webhook"]}) */
  channelFallbacks: z
    .string()
    .default("{}")
    .transform((val): Record<string, string[]> => {
      if (!val) return {};
      try {
        return JSON.parse(val) as Record<string, string[]>;
      } catch {
        return {};
      }
    }),

  // Webhook Encryption
  /** AES-256-GCM key for encrypting webhook secrets at rest */
  webhookEncryptionKey: z.string().optional(),

  // Cleanup
  /** Retention period in days for expired tokens/deliveries (default: 30) */
  cleanupRetentionDays: z.coerce.number().int().min(1).default(30),
  /** Cleanup interval in milliseconds (default: 1 hour) */
  cleanupIntervalMs: z.coerce.number().int().min(1000).default(3_600_000),

  // API Key Cache
  /** API key cache TTL in seconds (default: 60) */
  apiKeyCacheTtlSec: z.coerce.number().int().min(1).default(60),
  /** Max API key cache entries (default: 1000) */
  apiKeyCacheMaxSize: z.coerce.number().int().min(1).default(1000),

  // OIDC / SSO
  /** When true, API key auth is blocked — only SSO login is accepted */
  ssoEnforced: z
    .union([z.boolean(), z.string()])
    .transform((val) => {
      if (typeof val === "boolean") return val;
      return ["true", "1", "yes"].includes(val.toLowerCase());
    })
    .default(false),
  /** Maps OIDC groups to roles (JSON string, e.g. {"engineering":"editor","security":"admin"}) */
  oidcGroupMapping: z
    .string()
    .default("{}")
    .transform((val) => {
      try {
        return JSON.parse(val) as Record<string, string>;
      } catch {
        return {} as Record<string, string>;
      }
    }),
  /** Max JWT session lifetime in seconds (default: 86400 = 24h) */
  maxSessionDurationSec: z.coerce.number().int().min(60).default(86400),
  /** OIDC issuer URL (e.g., https://login.corp.com) */
  oidcIssuer: z.string().optional(),
  /** OIDC client ID */
  oidcClientId: z.string().optional(),
  /** OIDC client secret */
  oidcClientSecret: z.string().optional(),
  /** OIDC callback redirect URI */
  oidcRedirectUri: z.string().optional(),
  /** JWT claim for tenant/org ID */
  oidcTenantClaim: z.string().default("tenant_id"),
  /** JWT claim for user role */
  oidcRoleClaim: z.string().default("role"),
  /** Auth mode: dual (API key + OIDC), oidc-required, api-key-only */
  authMode: z.enum(["dual", "oidc-required", "api-key-only"]).default("dual"),
  /** Access token TTL in seconds (default: 900 = 15 min) */
  jwtAccessTtl: z.coerce.number().int().min(60).default(900),
  /** Refresh token TTL in seconds (default: 604800 = 7 days) */
  jwtRefreshTtl: z.coerce.number().int().min(60).default(604800),

  // ─── Asymmetric agent tokens (#40) ──────────────────────────────────
  /** PKCS#8 PEM RSA private key for RS256-signing agent tokens. Unset = sign
   *  with the shared HS256 JWT_SECRET (the local fast path, unchanged). When
   *  set, the matching public key is published at GET /.well-known/jwks.json so
   *  downstream verifiers (AgentLens, Lore) verify WITHOUT holding the shared
   *  secret — one leaked secret can no longer mint tokens anywhere. */
  agentTokenSigningKey: z.string().optional(),
  /** Key id (kid) for the active RS256 signer. Defaults to the JWK thumbprint. */
  agentTokenSigningKid: z.string().optional(),
  /** JSON array of public JWKs (each with a kid) to ALSO publish + accept on
   *  verify — retired signers kept live during a key rotation until their last
   *  issued token expires. */
  agentTokenVerifyKeys: z.string().optional(),
  /** Optional audience (aud) claim minted into RS256 agent tokens and required
   *  on verify when set (scopes a token to e.g. "agentlens"). HS256 tokens are
   *  NOT audience-scoped — this requires AGENT_TOKEN_SIGNING_KEY. */
  agentTokenAudience: z.string().optional(),
  /** Optional issuer (iss) claim minted into RS256 agent tokens so standard
   *  JWKS verifiers (AgentLens, Lore) can pin the issuer. */
  agentTokenIssuer: z.string().optional(),

  // ─── External SPIFFE/WIMSE workload identity (#41) ──────────────────
  /** Accept SPIFFE JWT-SVIDs whose audience equals this value. REQUIRED to
   *  enable SPIFFE verification (the spec mandates audience validation). */
  spiffeAudience: z.string().optional(),
  /** Trust domain to pin SPIFFE IDs to, e.g. "example.org" → only
   *  `spiffe://example.org/...` subjects are accepted. REQUIRED to enable SPIFFE
   *  (a multi-domain/federation bundle must not authenticate an unexpected
   *  domain as a fully-verified principal). */
  spiffeTrustDomain: z.string().optional(),
  /** URL of the SPIFFE trust bundle (a JWKS) for verifying SVID signatures.
   *  Validated as a URL so a typo fails closed at startup, not per-request. */
  spiffeJwksUrl: z.string().url().optional(),
  /** Inline SPIFFE trust bundle as JWKS JSON (alternative to SPIFFE_JWKS_URL,
   *  e.g. air-gapped). */
  spiffeTrustBundle: z.string().optional(),
  /** Optional max SVID age (seconds, checked against `iat`) — bounds acceptance
   *  even if a trust domain mis-issues a long-lived SVID. Unset = only `exp`. */
  spiffeMaxSvidAge: z.coerce.number().int().min(1).optional(),

  // ─── Per-agent spend / budgets (#13) ────────────────────────────────
  /** AgentLens base URL — source of per-agent spend telemetry. Unset = spend
   *  reads disabled. */
  agentlensUrl: z.string().optional(),
  /** Shared service token for AgentLens' POST /api/internal/spend. */
  agentgateServiceToken: z.string().optional(),
  /** Timeout (ms) for ALL AgentLens spend reads (budget path + GET /:id/spend).
   *  Kept short so a slow AgentLens can't add tail latency to POST /api/requests;
   *  raise it if your AgentLens is far/slow and informational reads 502. */
  spendReadTimeoutMs: z.coerce.number().int().min(100).default(5000),
  /** Enforce per-agent monthly budgets (deny over-budget requests). Default off
   *  so the feature ships dark until an operator opts in. */
  agentBudgetEnforcement: z
    .union([z.boolean(), z.string()])
    .transform((val) => (typeof val === "boolean" ? val : ["true", "1", "yes"].includes(val.toLowerCase())))
    .default(false),
  /** Emit near-limit budget notifications (80%/100% of cap) via the dispatcher.
   *  Independent of enforcement — warn without denying. Default off. */
  agentBudgetAlerts: z
    .union([z.boolean(), z.string()])
    .transform((val) => (typeof val === "boolean" ? val : ["true", "1", "yes"].includes(val.toLowerCase())))
    .default(false),
  /** Per-agent eval gate (#7): deny requests from an agent whose latest eval
   *  pass-rate (read from AgentLens) is below agentEvalMinPassRate. Default off
   *  — ships dark until an operator opts in. Fails open. */
  agentEvalGate: z
    .union([z.boolean(), z.string()])
    .transform((val) => (typeof val === "boolean" ? val : ["true", "1", "yes"].includes(val.toLowerCase())))
    .default(false),
  /** Minimum eval pass-rate (0..1) an agent must meet when AGENT_EVAL_GATE is on. */
  agentEvalMinPassRate: z.coerce.number().min(0).max(1).default(0.8),

  // Metrics
  /** Enable Prometheus metrics endpoint (default true) */
  metricsEnabled: z
    .union([z.boolean(), z.string()])
    .transform((val) => {
      if (typeof val === "boolean") return val;
      return ["true", "1", "yes"].includes(val.toLowerCase());
    })
    .default(true),

  // Logging
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  logFormat: z.enum(["json", "pretty"]).default("pretty"),
}).transform((config) => ({
  ...config,
  /** Convenience: true if nodeEnv === 'development' */
  isDevelopment: config.nodeEnv === "development",
  /** Convenience: true if nodeEnv === 'production' */
  isProduction: config.nodeEnv === "production",
}));

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
  CORS_ALLOWED_ORIGINS: "corsAllowedOrigins",
  HSTS_ENABLED: "hstsEnabled",
  RATE_LIMIT_RPM: "rateLimitRpm",
  RATE_LIMIT_ENABLED: "rateLimitEnabled",
  RATE_LIMIT_BACKEND: "rateLimitBackend",
  REDIS_URL: "redisUrl",
  DECISION_TOKEN_EXPIRY_HOURS: "decisionTokenExpiryHours",
  DECISION_LINK_BASE_URL: "decisionLinkBaseUrl",
  REQUEST_TIMEOUT_SEC: "requestTimeoutSec",
  WEBHOOK_TIMEOUT_MS: "webhookTimeoutMs",
  WEBHOOK_MAX_RETRIES: "webhookMaxRetries",
  AGENTGATE_ALLOW_PRIVATE_WEBHOOKS: "allowPrivateWebhooks",
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
  CHANNEL_FALLBACKS: "channelFallbacks",
  WEBHOOK_ENCRYPTION_KEY: "webhookEncryptionKey",
  CLEANUP_RETENTION_DAYS: "cleanupRetentionDays",
  CLEANUP_INTERVAL_MS: "cleanupIntervalMs",
  API_KEY_CACHE_TTL_SEC: "apiKeyCacheTtlSec",
  API_KEY_CACHE_MAX_SIZE: "apiKeyCacheMaxSize",
  METRICS_ENABLED: "metricsEnabled",
  LOG_LEVEL: "logLevel",
  LOG_FORMAT: "logFormat",
  SSO_ENFORCED: "ssoEnforced",
  OIDC_GROUP_MAPPING: "oidcGroupMapping",
  MAX_SESSION_DURATION_SEC: "maxSessionDurationSec",
  OIDC_ISSUER: "oidcIssuer",
  OIDC_CLIENT_ID: "oidcClientId",
  OIDC_CLIENT_SECRET: "oidcClientSecret",
  OIDC_REDIRECT_URI: "oidcRedirectUri",
  OIDC_TENANT_CLAIM: "oidcTenantClaim",
  OIDC_ROLE_CLAIM: "oidcRoleClaim",
  AUTH_MODE: "authMode",
  JWT_ACCESS_TTL: "jwtAccessTtl",
  JWT_REFRESH_TTL: "jwtRefreshTtl",
  AGENTLENS_URL: "agentlensUrl",
  AGENTGATE_SERVICE_TOKEN: "agentgateServiceToken",
  SPEND_READ_TIMEOUT_MS: "spendReadTimeoutMs",
  AGENT_BUDGET_ENFORCEMENT: "agentBudgetEnforcement",
  AGENT_BUDGET_ALERTS: "agentBudgetAlerts",
  AGENT_EVAL_GATE: "agentEvalGate",
  AGENT_EVAL_MIN_PASS_RATE: "agentEvalMinPassRate",
  AGENT_TOKEN_SIGNING_KEY: "agentTokenSigningKey",
  AGENT_TOKEN_SIGNING_KID: "agentTokenSigningKid",
  AGENT_TOKEN_VERIFY_KEYS: "agentTokenVerifyKeys",
  AGENT_TOKEN_AUDIENCE: "agentTokenAudience",
  AGENT_TOKEN_ISSUER: "agentTokenIssuer",
  SPIFFE_AUDIENCE: "spiffeAudience",
  SPIFFE_TRUST_DOMAIN: "spiffeTrustDomain",
  SPIFFE_JWKS_URL: "spiffeJwksUrl",
  SPIFFE_TRUST_BUNDLE: "spiffeTrustBundle",
  SPIFFE_MAX_SVID_AGE: "spiffeMaxSvidAge",
};

// ============================================================================
// Config Loading Functions
// ============================================================================

// ============================================================================
// File-Based Secrets (_FILE suffix support for Docker secrets)
// ============================================================================

/** Secret keys that support _FILE suffix for Docker secrets */
const SECRET_KEYS = [
  "ADMIN_API_KEY",
  "JWT_SECRET",
  "AGENTGATE_SERVICE_TOKEN",
  "DATABASE_URL",
  "REDIS_URL",
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "DISCORD_BOT_TOKEN",
  "SMTP_PASS",
  "WEBHOOK_ENCRYPTION_KEY",
  "OIDC_CLIENT_SECRET",
  "AGENT_TOKEN_SIGNING_KEY",
] as const;

/**
 * Resolve _FILE suffixed env vars into their base env vars.
 * For each secret key, if KEY_FILE is set and KEY is not,
 * reads the file and sets KEY in process.env.
 * This allows Docker secrets mounted as files to be used transparently.
 */
function resolveFileSecrets(): void {
  for (const key of SECRET_KEYS) {
    const fileKey = `${key}_FILE`;
    const filePath = process.env[fileKey];
    if (filePath && !process.env[key]) {
      try {
        process.env[key] = readFileSync(filePath, "utf-8").trim();
      } catch (err) {
        // console.error is intentional: logger is not initialized at config load time
        console.error(
          `Warning: Could not read secret file for ${fileKey}: ${err}`
        );
      }
    }
  }
}

/**
 * Load raw values from environment variables
 */
function loadFromEnv(): Record<string, unknown> {
  resolveFileSecrets();

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
      warnings.push("JWT_SECRET is required in production");
    }
    if (!config.corsAllowedOrigins) {
      warnings.push("CORS_ALLOWED_ORIGINS should be set in production");
    }
    if (!config.webhookEncryptionKey) {
      warnings.push("WEBHOOK_ENCRYPTION_KEY should be set to encrypt webhook secrets at rest");
    }
    if (config.allowPrivateWebhooks) {
      warnings.push(
        "AGENTGATE_ALLOW_PRIVATE_WEBHOOKS is ON — the webhook SSRF guard is " +
          "permitting loopback/private-range destinations. This is a dev/test-only " +
          "escape hatch and must NOT be enabled in production.",
      );
    }
    // Require OIDC config when auth mode needs it
    if (config.authMode !== "api-key-only") {
      if (!config.oidcIssuer) {
        warnings.push("OIDC_ISSUER is required when AUTH_MODE is not api-key-only");
      }
      if (!config.oidcClientId) {
        warnings.push("OIDC_CLIENT_ID is required when AUTH_MODE is not api-key-only");
      }
      if (!config.oidcClientSecret) {
        warnings.push("OIDC_CLIENT_SECRET is required when AUTH_MODE is not api-key-only");
      }
      if (!config.oidcRedirectUri) {
        warnings.push("OIDC_REDIRECT_URI is required when AUTH_MODE is not api-key-only");
      }
    }
  }

  // Audience scoping only applies to the RS256 path (#40); the HS256 fast path
  // cannot set or check `aud`. Warn so an operator isn't lulled into thinking
  // their tokens are audience-bound when they are accepted everywhere.
  if (config.agentTokenAudience && !config.agentTokenSigningKey) {
    warnings.push(
      "AGENT_TOKEN_AUDIENCE has no effect without AGENT_TOKEN_SIGNING_KEY " +
        "(audience scoping requires the RS256/JWKS path)",
    );
  }
  if (config.agentTokenIssuer && !config.agentTokenSigningKey) {
    warnings.push(
      "AGENT_TOKEN_ISSUER has no effect without AGENT_TOKEN_SIGNING_KEY " +
        "(the iss claim is only minted on the RS256 path)",
    );
  }

  // SPIFFE needs audience + trust domain + a bundle; surface a partial config so
  // it isn't silently disabled.
  const spiffeBundle = config.spiffeJwksUrl || config.spiffeTrustBundle;
  if ((config.spiffeAudience || spiffeBundle) && !(config.spiffeAudience && config.spiffeTrustDomain && spiffeBundle)) {
    warnings.push(
      "SPIFFE verification is DISABLED: it requires SPIFFE_AUDIENCE + " +
        "SPIFFE_TRUST_DOMAIN + (SPIFFE_JWKS_URL or SPIFFE_TRUST_BUNDLE) all set",
    );
  }

  return warnings;
}

// ============================================================================
// JWT Secret Resolution (fail-closed)
// ============================================================================

/** The dev placeholder that must never be used as a real signing secret. */
export const DEV_JWT_SECRET_PLACEHOLDER = "dev-secret-not-for-production";

/**
 * Resolve the JWT signing/verification secret, failing closed.
 *
 * JWT is only used when auth mode is "dual" or "oidc-required". In
 * "api-key-only" mode JWT auth is never exercised, so a secret is not
 * required and this returns the (unused) placeholder to keep that
 * fully-supported mode working.
 *
 * In any JWT-enabled mode, if JWT_SECRET is unset or equals the dev
 * placeholder, this THROWS — we refuse to sign/verify tokens with a
 * known secret rather than silently weakening auth.
 *
 * @throws {Error} when JWT is enabled but no real secret is configured
 */
export function resolveJwtSecret(config: Config): string {
  const jwtEnabled = config.authMode !== "api-key-only";

  if (!jwtEnabled) {
    // JWT is not used in api-key-only mode; secret value is irrelevant.
    return config.jwtSecret ?? DEV_JWT_SECRET_PLACEHOLDER;
  }

  if (!config.jwtSecret || config.jwtSecret === DEV_JWT_SECRET_PLACEHOLDER) {
    throw new Error(
      `JWT_SECRET is required when AUTH_MODE is "${config.authMode}" ` +
        `(JWT/OIDC auth is enabled). Set JWT_SECRET to a strong secret of ` +
        `at least 32 characters. Refusing to start with a known/placeholder ` +
        `signing secret.`
    );
  }

  return config.jwtSecret;
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
