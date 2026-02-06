/**
 * PostgreSQL schema definition for AgentGate
 */
import { pgTable, text, integer, timestamp, boolean, index } from "drizzle-orm/pg-core";

// Approval requests table
export const approvalRequests = pgTable("approval_requests", {
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
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  decidedAt: timestamp("decided_at", { mode: "date" }),
  decidedBy: text("decided_by"),
  decisionReason: text("decision_reason"),
  expiresAt: timestamp("expires_at", { mode: "date" }),
});

// Indexes for approval_requests
export const idxRequestsStatus = index("idx_requests_status").on(approvalRequests.status);
export const idxRequestsAction = index("idx_requests_action").on(approvalRequests.action);
export const idxRequestsCreatedAt = index("idx_requests_created_at").on(approvalRequests.createdAt);

// Audit logs table
export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  requestId: text("request_id")
    .notNull()
    .references(() => approvalRequests.id),
  eventType: text("event_type", {
    enum: ["created", "approved", "denied", "expired", "viewed"],
  }).notNull(),
  actor: text("actor").notNull(),
  details: text("details"), // JSON stringified
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
});

// Index for audit_logs
export const idxAuditRequestId = index("idx_audit_request_id").on(auditLogs.requestId);

// Policies table
export const policies = pgTable("policies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  rules: text("rules").notNull(), // JSON stringified
  priority: integer("priority").notNull(),
  enabled: boolean("enabled").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
});

// API keys table
export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  keyHash: text("key_hash").notNull(),
  name: text("name").notNull(),
  scopes: text("scopes").notNull(), // JSON array of scopes
  createdAt: integer("created_at").notNull(), // unix timestamp
  lastUsedAt: integer("last_used_at"), // unix timestamp, nullable
  revokedAt: integer("revoked_at"), // unix timestamp, nullable
  rateLimit: integer("rate_limit"), // requests per minute, null = unlimited
});

// Index for api_keys
export const idxApiKeysHash = index("idx_api_keys_hash").on(apiKeys.keyHash);

// Webhooks table
export const webhooks = pgTable("webhooks", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: text("events").notNull(), // JSON array like ["request.approved", "request.denied"]
  createdAt: integer("created_at").notNull(), // unix timestamp
  enabled: integer("enabled").notNull().default(1), // 0 or 1 for compatibility
});

// Webhook deliveries table
export const webhookDeliveries = pgTable("webhook_deliveries", {
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
});

// Indexes for webhook_deliveries
export const idxDeliveriesWebhookId = index("idx_deliveries_webhook_id").on(webhookDeliveries.webhookId);
export const idxDeliveriesStatus = index("idx_deliveries_status").on(webhookDeliveries.status);

// Decision tokens table for one-click approve/deny links
export const decisionTokens = pgTable("decision_tokens", {
  id: text("id").primaryKey(),
  requestId: text("request_id")
    .notNull()
    .references(() => approvalRequests.id),
  action: text("action", {
    enum: ["approve", "deny"],
  }).notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  usedAt: timestamp("used_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
});

// Index for decision_tokens
export const idxTokensRequestId = index("idx_tokens_request_id").on(decisionTokens.requestId);

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
