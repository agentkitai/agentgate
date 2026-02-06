// @agentgate/core - Core types and policy engine

export const VERSION = '0.0.1';

// Types
export type {
  ApprovalStatus,
  ApprovalUrgency,
  DecisionType,
  ApprovalRequest,
  MatcherValue,
  PolicyRule,
  Policy,
  PolicyDecision,
} from './types.js';

// Policy engine
export { evaluatePolicy } from './policy-engine.js';

// Events
export {
  EventNames,
  type EventName,
  type BaseEvent,
  type RequestCreatedEvent,
  type RequestUpdatedEvent,
  type RequestDecidedEvent,
  type RequestExpiredEvent,
  type RequestEscalatedEvent,
  type PolicyMatchedEvent,
  type WebhookTriggeredEvent,
  type WebhookFailedEvent,
  type ApiKeyRateLimitedEvent,
  type AgentGateEvent,
  createBaseEvent,
  eventMatchesFilter,
} from './events.js';

// Event Emitter
export {
  AgentGateEmitter,
  type EventListener,
  getGlobalEmitter,
  resetGlobalEmitter,
  createEmitter,
} from './emitter.js';

// HTTP Client
export { AgentGateHttpClient } from './http-client.js';
