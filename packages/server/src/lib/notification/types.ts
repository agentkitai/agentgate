/**
 * Notification system types
 */

import type { AgentGateEvent, ApprovalUrgency } from "@agentgate/core";

/**
 * Supported notification channel types
 */
export type NotificationChannelType = "email" | "slack" | "discord" | "webhook";

/**
 * Configuration for a channel route
 */
export interface ChannelRoute {
  /** Unique identifier for this route */
  id?: string;
  /** Channel type */
  channel: NotificationChannelType;
  /** Target identifier (email address, channel ID, webhook URL) */
  target: string;
  /** Optional filter: only route events matching these event types */
  eventTypes?: string[];
  /** Optional filter: only route events matching these actions */
  actions?: string[];
  /** Optional filter: only route events with these urgency levels */
  urgencies?: ApprovalUrgency[];
  /** Whether this route is enabled */
  enabled?: boolean;
}

/**
 * Result of a notification delivery attempt
 */
export interface NotificationResult {
  /** Whether delivery was successful */
  success: boolean;
  /** Channel type */
  channel: NotificationChannelType;
  /** Target that was notified */
  target: string;
  /** Error message if delivery failed */
  error?: string;
  /** Timestamp of the attempt */
  timestamp: number;
  /** Response from the channel (if any) */
  response?: unknown;
}

/**
 * Channel adapter interface
 *
 * Each notification channel (email, slack, discord, etc.) implements this interface.
 */
export interface NotificationChannelAdapter {
  /** Channel type identifier */
  readonly type: NotificationChannelType;

  /**
   * Send a notification for an event
   */
  send(target: string, event: AgentGateEvent): Promise<NotificationResult>;

  /**
   * Check if the adapter is properly configured
   */
  isConfigured(): boolean;
}

/**
 * Dispatcher options
 */
export interface DispatcherOptions {
  /** Default routes to use when policy doesn't specify channels */
  defaultRoutes?: ChannelRoute[];
  /** Whether to fail silently on delivery errors */
  failSilently?: boolean;
  /** Log level for notification delivery */
  logLevel?: "debug" | "info" | "warn" | "error";
}
