// @agentkitai/agentgate-sdk - TypeScript SDK for agents

export const VERSION = '0.0.1';

// Client
export { AgentGateClient } from './client.js';
export type {
  ClientOptions,
  RequestOptions,
  WaitOptions,
  ListOptions,
  PolicyCreateOptions,
  PolicyUpdateOptions,
  Webhook,
  WebhookWithDeliveries,
  WebhookDelivery,
  WebhookCreateOptions,
  WebhookCreateResult,
  WebhookUpdateOptions,
  WebhookTestResult,
  AuditEntry,
  AuditListOptions,
  AuditListResult,
  ApiKey,
  ApiKeyCreateOptions,
  ApiKeyCreateResult,
} from './client.js';

// Errors
export { AgentGateError, TimeoutError } from './errors.js';

// Re-export types from core for convenience
export type {
  ApprovalStatus,
  ApprovalUrgency,
  ApprovalRequest,
  DecisionType,
  PolicyRule,
  Policy,
  PolicyDecision,
} from '@agentkitai/agentgate-core';
