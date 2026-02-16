/**
 * SQLite schema definition for AgentGate
 */
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// Approval requests table
export const approvalRequests = sqliteTable("approval_requests", {
  id: text("id").primaryKey(),
  action: text("action").notNull(),
  params: text("params"), // JSON stringified
  context: text("context"), // JSON stringified
  status: text("status", {
    enum: ["pending", "approved", "denied", "expired"],
  }).notNull(),
  urgency: text("urgency", {
    enum: ["low", "normal", "high", "critical"],
  }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  decidedAt: integer("decided_at", { mode: "timestamp" }),
  decidedBy: text("decided_by"),
  decisionReason: text("decision_reason"),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
}, (table) => ({
  idxRequestsStatus: index("idx_requests_status").on(table.status),
  idxRequestsAction: index("idx_requests_action").on(table.action),
  idxRequestsCreatedAt: index("idx_requests_created_at").on(table.createdAt),
}));

// Audit logs table
export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  requestId: text("request_id")
    .notNull()
    .references(() => approvalRequests.id),
  eventType: text("event_type", {
    enum: ["created", "approved", "denied", "expired", "viewed"],
  }).notNull(),
  actor: text("actor").notNull(),
  details: text("details"), // JSON stringified
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => ({
  idxAuditRequestId: index("idx_audit_request_id").on(table.requestId),
}));

// Policies table
export const policies = sqliteTable("policies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  rules: text("rules").notNull(), // JSON stringified
  priority: integer("priority").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// API keys table
export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  keyHash: text("key_hash").notNull(),
  name: text("name").notNull(),
  scopes: text("scopes").notNull(), // JSON array of scopes
  createdAt: integer("created_at").notNull(), // unix timestamp
  lastUsedAt: integer("last_used_at"), // unix timestamp, nullable
  revokedAt: integer("revoked_at"), // unix timestamp, nullable
  rateLimit: integer("rate_limit"), // requests per minute, null = unlimited
}, (table) => ({
  idxApiKeysHash: index("idx_api_keys_hash").on(table.keyHash),
}));

// Webhooks table
export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: text("events").notNull(), // JSON array like ["request.approved", "request.denied"]
  createdAt: integer("created_at").notNull(), // unix timestamp
  enabled: integer("enabled").notNull().default(1), // 0 or 1
});

// Webhook deliveries table
export const webhookDeliveries = sqliteTable("webhook_deliveries", {
  id: text("id").primaryKey(),
  webhookId: text("webhook_id")
    .notNull()
    .references(() => webhooks.id),
  event: text("event").notNull(),
  payload: text("payload").notNull(), // JSON payload sent
  status: text("status", {
    enum: ["pending", "success", "failed"],
  }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastAttemptAt: integer("last_attempt_at"), // unix timestamp, nullable
  responseCode: integer("response_code"), // nullable
  responseBody: text("response_body"), // nullable
}, (table) => ({
  idxDeliveriesWebhookId: index("idx_deliveries_webhook_id").on(table.webhookId),
  idxDeliveriesStatus: index("idx_deliveries_status").on(table.status),
}));

// Decision tokens table for one-click approve/deny links
export const decisionTokens = sqliteTable("decision_tokens", {
  id: text("id").primaryKey(),
  requestId: text("request_id")
    .notNull()
    .references(() => approvalRequests.id),
  action: text("action", {
    enum: ["approve", "deny"],
  }).notNull(),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => ({
  idxTokensRequestId: index("idx_tokens_request_id").on(table.requestId),
}));

// Overrides table — dynamic policy overrides (e.g. from AgentLens threshold alerts)
export const overrides = sqliteTable("overrides", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  toolPattern: text("tool_pattern").notNull(),
  action: text("action", {
    enum: ["require_approval"],
  }).notNull(),
  reason: text("reason"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
}, (table) => ({
  idxOverridesAgentId: index("idx_overrides_agent_id").on(table.agentId),
  idxOverridesExpiresAt: index("idx_overrides_expires_at").on(table.expiresAt),
}));

// Users table (OIDC-authenticated users)
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  oidcSub: text("oidc_sub").notNull().unique(),
  email: text("email"),
  displayName: text("display_name"),
  role: text("role", {
    enum: ["viewer", "editor", "admin", "owner"],
  }).notNull().default("viewer"),
  tenantId: text("tenant_id").notNull().default("default"),
  createdAt: integer("created_at").notNull(), // unix timestamp
  disabledAt: integer("disabled_at"), // unix timestamp, nullable
}, (table) => ({
  idxUsersSub: index("idx_users_sub").on(table.oidcSub),
}));

// Refresh tokens table
export const refreshTokens = sqliteTable("refresh_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  tenantId: text("tenant_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer("expires_at").notNull(), // unix timestamp
  revokedAt: integer("revoked_at"), // unix timestamp, nullable
}, (table) => ({
  idxRefreshTokensHash: index("idx_refresh_tokens_hash").on(table.tokenHash),
}));

// Type exports
export type ApprovalRequest = typeof approvalRequests.$inferSelect;
export type NewApprovalRequest = typeof approvalRequests.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type Policy = typeof policies.$inferSelect;
export type NewPolicy = typeof policies.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type Webhook = typeof webhooks.$inferSelect;
export type NewWebhook = typeof webhooks.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
export type DecisionToken = typeof decisionTokens.$inferSelect;
export type NewDecisionToken = typeof decisionTokens.$inferInsert;
export type Override = typeof overrides.$inferSelect;
export type NewOverride = typeof overrides.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
