/**
 * Notification system
 *
 * Provides event-driven notifications to various channels (email, Slack, Discord, webhooks).
 */

// Types
export type {
  NotificationChannelType,
  ChannelRoute,
  NotificationResult,
  NotificationChannelAdapter,
  DispatcherOptions,
} from "./types.js";

// Dispatcher
export {
  NotificationDispatcher,
  getGlobalDispatcher,
  resetGlobalDispatcher,
  createDispatcher,
} from "./dispatcher.js";

// Health Tracker
export {
  ChannelHealthTracker,
  getHealthTracker,
  resetHealthTracker,
  type ChannelHealth,
  type ChannelStatus,
} from "./health.js";

// Adapters
export {
  EmailAdapter,
  SlackAdapter,
  DiscordAdapter,
  WebhookAdapter,
} from "./adapters/index.js";
