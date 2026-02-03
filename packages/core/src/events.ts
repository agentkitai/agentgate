/**
 * Event types for AgentGate notifications
 * These events are emitted when significant actions occur in the system
 */

import type { ApprovalStatus, ApprovalUrgency, DecisionType } from "./types.js";

// ============================================================================
// Event Names (Constants)
// ============================================================================

/**
 * Standardized event names used throughout the system
 */
export const EventNames = {
  // Request lifecycle events
  REQUEST_CREATED: "request.created",
  REQUEST_UPDATED: "request.updated",
  REQUEST_DECIDED: "request.decided",
  REQUEST_EXPIRED: "request.expired",
  REQUEST_ESCALATED: "request.escalated",

  // Policy events
  POLICY_CREATED: "policy.created",
  POLICY_UPDATED: "policy.updated",
  POLICY_DELETED: "policy.deleted",
  POLICY_MATCHED: "policy.matched",

  // Webhook events
  WEBHOOK_TRIGGERED: "webhook.triggered",
  WEBHOOK_FAILED: "webhook.failed",
  WEBHOOK_RETRY: "webhook.retry",

  // API key events
  API_KEY_CREATED: "api_key.created",
  API_KEY_REVOKED: "api_key.revoked",
  API_KEY_RATE_LIMITED: "api_key.rate_limited",

  // System events
  SYSTEM_STARTUP: "system.startup",
  SYSTEM_SHUTDOWN: "system.shutdown",
  SYSTEM_ERROR: "system.error",
} as const;

export type EventName = (typeof EventNames)[keyof typeof EventNames];

// ============================================================================
// Base Event Interface
// ============================================================================

/**
 * Base interface for all events
 */
export interface BaseEvent<T extends EventName = EventName> {
  /** Event type identifier */
  type: T;
  /** Unix timestamp when the event occurred */
  timestamp: number;
  /** Unique event ID */
  eventId: string;
  /** Source that generated the event */
  source: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Request Events
// ============================================================================

/**
 * Emitted when a new approval request is created
 */
export interface RequestCreatedEvent
  extends BaseEvent<typeof EventNames.REQUEST_CREATED> {
  payload: {
    requestId: string;
    action: string;
    params: Record<string, unknown>;
    context: Record<string, unknown>;
    urgency: ApprovalUrgency;
    expiresAt?: string;
    /** Policy decision that was applied (if any) */
    policyDecision?: {
      decision: DecisionType;
      policyId?: string;
      ruleName?: string;
    };
  };
}

/**
 * Emitted when a request is updated (e.g., status change, metadata update)
 */
export interface RequestUpdatedEvent
  extends BaseEvent<typeof EventNames.REQUEST_UPDATED> {
  payload: {
    requestId: string;
    changes: {
      field: string;
      oldValue: unknown;
      newValue: unknown;
    }[];
  };
}

/**
 * Emitted when a request receives a decision (approved/denied)
 */
export interface RequestDecidedEvent
  extends BaseEvent<typeof EventNames.REQUEST_DECIDED> {
  payload: {
    requestId: string;
    action: string;
    status: Extract<ApprovalStatus, "approved" | "denied">;
    decidedBy: string;
    decidedByType: "human" | "agent" | "policy";
    reason?: string;
    /** Time from creation to decision in milliseconds */
    decisionTimeMs: number;
  };
}

/**
 * Emitted when a request expires without a decision
 */
export interface RequestExpiredEvent
  extends BaseEvent<typeof EventNames.REQUEST_EXPIRED> {
  payload: {
    requestId: string;
    action: string;
    urgency: ApprovalUrgency;
    /** How long the request was pending in milliseconds */
    pendingTimeMs: number;
  };
}

/**
 * Emitted when a request is escalated to a different approver/channel
 */
export interface RequestEscalatedEvent
  extends BaseEvent<typeof EventNames.REQUEST_ESCALATED> {
  payload: {
    requestId: string;
    action: string;
    fromApprover?: string;
    toApprover?: string;
    fromChannel?: string;
    toChannel?: string;
    reason?: string;
  };
}

// ============================================================================
// Policy Events
// ============================================================================

/**
 * Emitted when a policy matches a request
 */
export interface PolicyMatchedEvent
  extends BaseEvent<typeof EventNames.POLICY_MATCHED> {
  payload: {
    requestId: string;
    policyId: string;
    policyName: string;
    decision: DecisionType;
    matchedRule: {
      index: number;
      match: Record<string, unknown>;
    };
  };
}

// ============================================================================
// Webhook Events
// ============================================================================

/**
 * Emitted when a webhook is triggered
 */
export interface WebhookTriggeredEvent
  extends BaseEvent<typeof EventNames.WEBHOOK_TRIGGERED> {
  payload: {
    webhookId: string;
    url: string;
    triggerEvent: EventName;
    requestId?: string;
    statusCode?: number;
    responseTimeMs?: number;
  };
}

/**
 * Emitted when a webhook delivery fails
 */
export interface WebhookFailedEvent
  extends BaseEvent<typeof EventNames.WEBHOOK_FAILED> {
  payload: {
    webhookId: string;
    url: string;
    triggerEvent: EventName;
    error: string;
    attempt: number;
    willRetry: boolean;
  };
}

// ============================================================================
// API Key Events
// ============================================================================

/**
 * Emitted when an API key is rate limited
 */
export interface ApiKeyRateLimitedEvent
  extends BaseEvent<typeof EventNames.API_KEY_RATE_LIMITED> {
  payload: {
    apiKeyId: string;
    endpoint: string;
    requestsInWindow: number;
    limitPerMinute: number;
  };
}

// ============================================================================
// Union Type
// ============================================================================

/**
 * Union of all event types
 */
export type AgentGateEvent =
  | RequestCreatedEvent
  | RequestUpdatedEvent
  | RequestDecidedEvent
  | RequestExpiredEvent
  | RequestEscalatedEvent
  | PolicyMatchedEvent
  | WebhookTriggeredEvent
  | WebhookFailedEvent
  | ApiKeyRateLimitedEvent;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a base event with common fields
 */
export function createBaseEvent<T extends EventName>(
  type: T,
  source: string = "agentgate"
): Omit<BaseEvent<T>, "payload"> {
  return {
    type,
    timestamp: Date.now(),
    eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    source,
  };
}

/**
 * Check if an event matches a filter
 */
export function eventMatchesFilter(
  event: AgentGateEvent,
  filter: {
    types?: EventName[];
    actions?: string[];
    urgencies?: ApprovalUrgency[];
  }
): boolean {
  // Check event type
  if (filter.types && filter.types.length > 0) {
    if (!filter.types.includes(event.type)) {
      return false;
    }
  }

  // Check action (only for request events)
  if (filter.actions && filter.actions.length > 0) {
    if ("payload" in event && "action" in event.payload) {
      const action = event.payload.action as string;
      if (!filter.actions.includes(action)) {
        return false;
      }
    }
  }

  // Check urgency (only for events with urgency)
  if (filter.urgencies && filter.urgencies.length > 0) {
    if ("payload" in event && "urgency" in event.payload) {
      const urgency = event.payload.urgency as ApprovalUrgency;
      if (!filter.urgencies.includes(urgency)) {
        return false;
      }
    }
  }

  return true;
}
