import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

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
});

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
});

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
});

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
});

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
