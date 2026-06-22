// @agentgate/core - Core types

/**
 * Status of an approval request
 */
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

/**
 * Urgency level for approval requests
 */
export type ApprovalUrgency = 'low' | 'normal' | 'high' | 'critical';

/**
 * Decision types for policy rules
 */
export type DecisionType = 'auto_approve' | 'auto_deny' | 'route_to_human' | 'route_to_agent';

/**
 * Namespace prefix for decidedBy field.
 * Format: `source:identifier` (e.g., "slack:U12345", "dashboard:admin", "mcp:user")
 */
export type DecidedByNamespace = 'slack' | 'discord' | 'dashboard' | 'mcp' | 'policy' | 'api' | 'system';

/**
 * Fully qualified decidedBy value: `namespace:identifier`
 */
export type DecidedByValue = `${DecidedByNamespace}:${string}`;

/**
 * An approval request from an agent
 */
export interface ApprovalRequest {
  /** Unique identifier for the request */
  id: string;
  /** The action being requested (e.g., "send_email", "transfer_funds") */
  action: string;
  /** Parameters for the action */
  params: Record<string, unknown>;
  /** Contextual information about the request */
  context: Record<string, unknown>;
  /** Current status of the request */
  status: ApprovalStatus;
  /** Urgency level */
  urgency: ApprovalUrgency;
  /** When the request was created */
  createdAt: Date;
  /** When the request was last updated */
  updatedAt: Date;
  /** When a decision was made (if any) */
  decidedAt?: Date;
  /** Who made the decision — namespaced as `source:identifier` (e.g., "slack:U12345") */
  decidedBy?: DecidedByValue;
  /** Reason provided for the decision */
  decisionReason?: string;
  /** When the request expires (if set) */
  expiresAt?: Date;
}

/**
 * Matcher value - can be exact value or operator object
 */
export type MatcherValue = 
  | string 
  | number 
  | boolean 
  | { $lt: number }
  | { $gt: number }
  | { $lte: number }
  | { $gte: number }
  | { $in: (string | number)[] }
  | { $regex: string };

/**
 * A single rule within a policy
 */
export interface PolicyRule {
  /** Matchers to check against the request */
  match: Record<string, MatcherValue>;
  /** Decision to return if this rule matches */
  decision: DecisionType;
  /** Specific approvers to route to (for route_to_human/route_to_agent) */
  approvers?: string[];
  /** Channels to send notifications to (e.g., Slack channels) */
  channels?: string[];
  /** Whether to require a reason for approval/denial */
  requireReason?: boolean;
}

/**
 * Where a policy applies. `global` (default) applies to every request;
 * `per_agent` only to requests from a verified agent in `agentIds`;
 * `per_tool` only to requests whose action is in `toolIds`.
 */
export type PolicyScope = 'global' | 'per_agent' | 'per_tool';

/**
 * A policy containing multiple rules
 */
export interface Policy {
  /** Unique identifier for the policy */
  id: string;
  /** Human-readable name */
  name: string;
  /** Rules to evaluate in order */
  rules: PolicyRule[];
  /** Priority (lower = higher priority, evaluated first) */
  priority: number;
  /** Whether this policy is active */
  enabled: boolean;
  /** Scope gate evaluated before rules. Defaults to 'global'. */
  scope?: PolicyScope;
  /** Verified agent ids this policy applies to (scope='per_agent'). */
  agentIds?: string[];
  /** Action/tool names this policy applies to (scope='per_tool'). */
  toolIds?: string[];
}

/**
 * Decision links for one-click approve/deny actions
 */
export interface DecisionLinks {
  /** URL for approving the request */
  approveUrl: string;
  /** URL for denying the request */
  denyUrl: string;
  /** URL to view the request in a dashboard */
  viewUrl?: string;
  /** When the links expire (ISO string) */
  expiresAt?: string;
}

/**
 * Result of policy evaluation
 */
export interface PolicyDecision {
  /** The decision to apply */
  decision: DecisionType;
  /** The rule that matched (if any) */
  matchedRule?: PolicyRule;
  /** Approvers to route to (from matched rule) */
  approvers?: string[];
  /** Channels to notify (from matched rule) */
  channels?: string[];
}
