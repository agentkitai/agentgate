/**
 * SQLite schema definition for AgentGate
 */
import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

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
  // Verified agent identity (migration: agent-identity spine). Null when the
  // request carried no agent credential; set to the agents.id whose credential
  // was verified for this request — distinct from the unverified context.agentId.
  verifiedAgentId: text("verified_agent_id"),
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
  // Per-agent policy scoping (issue #13). global = applies to all (legacy default).
  scope: text("scope", { enum: ["global", "per_agent", "per_tool"] }).notNull().default("global"),
  agentIds: text("agent_ids"), // JSON string[] of verified agent ids (scope=per_agent)
  toolIds: text("tool_ids"), // JSON string[] of action names (scope=per_tool)
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
  agentId: text("agent_id"), // virtual key: agt_* this key is bound to; null = any agent (legacy)
}, (table) => ({
  idxApiKeysHash: index("idx_api_keys_hash").on(table.keyHash),
}));

// Agent registry (agent-identity spine). A verifiable, non-human principal:
// an agent presents `X-Agent-Id` (agt_*) + `X-Agent-Secret`; the secret is
// stored only as a sha256 hash. Distinct from api_keys (human/service keys) so
// agent identity and per-agent scoping (virtual keys) stay cleanly separable.
export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(), // agt_<nanoid> — the public client id
  name: text("name").notNull(),
  secretHash: text("secret_hash").notNull(), // sha256(secret), hex
  status: text("status", { enum: ["active", "revoked"] }).notNull(),
  metadata: text("metadata"), // JSON stringified, nullable
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
  monthlyBudgetUsd: real("monthly_budget_usd"), // per-agent USD cap; null = no budget (#13)
}, (table) => ({
  idxAgentsStatus: index("idx_agents_status").on(table.status),
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
    enum: ["require_approval", "deny"],
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

// Escalation rules table
export const escalationRules = sqliteTable("escalation_rules", {
  id: text("id").primaryKey(),
  policyId: text("policy_id"), // nullable — null means global
  triggerAfterSec: integer("trigger_after_sec").notNull().default(1800), // 30 minutes
  escalateTo: text("escalate_to").notNull(), // format "channel:target", e.g., "slack:#escalation"
  priority: integer("priority").notNull().default(0),
  enabled: integer("enabled").notNull().default(1), // 0 or 1
  createdAt: integer("created_at").notNull(), // unix timestamp
}, (table) => ({
  idxEscalationRulesPolicyId: index("idx_escalation_rules_policy_id").on(table.policyId),
}));

// Escalation history table
export const escalationHistory = sqliteTable("escalation_history", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull(),
  ruleId: text("rule_id").notNull(),
  escalatedAt: integer("escalated_at").notNull(), // unix timestamp
  fromChannel: text("from_channel"),
  toChannel: text("to_channel").notNull(),
}, (table) => ({
  idxEscalationHistoryRequestId: index("idx_escalation_history_request_id").on(table.requestId),
  idxEscalationHistoryRuleId: index("idx_escalation_history_rule_id").on(table.ruleId),
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
export type EscalationRule = typeof escalationRules.$inferSelect;
export type NewEscalationRule = typeof escalationRules.$inferInsert;
export type EscalationHistory = typeof escalationHistory.$inferSelect;
export type NewEscalationHistory = typeof escalationHistory.$inferInsert;
