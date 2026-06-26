/**
 * Notification Dispatcher
 *
 * Routes events to appropriate notification channels based on:
 * 1. Policy-defined channels (from matched rule)
 * 2. Channel routes configuration
 * 3. Default channel configuration
 */

import {
  type AgentGateEvent,
  type EventName,
  type ApprovalUrgency,
  eventMatchesFilter,
} from "@agentkitai/agentgate-core";
import type {
  ChannelRoute,
  NotificationChannelAdapter,
  NotificationChannelType,
  NotificationResult,
  DispatcherOptions,
} from "./types.js";
import { EmailAdapter } from "./adapters/email.js";
import { SlackAdapter } from "./adapters/slack.js";
import { DiscordAdapter } from "./adapters/discord.js";
import { WebhookAdapter } from "./adapters/webhook.js";
import { getConfig } from "../../config.js";
import { getLogger } from "../logger.js";
import { getHealthTracker } from "./health.js";

/**
 * Notification Dispatcher
 *
 * Responsible for routing events to appropriate notification channels.
 */
export class NotificationDispatcher {
  private adapters: Map<NotificationChannelType, NotificationChannelAdapter> = new Map();
  private options: DispatcherOptions;

  constructor(options: DispatcherOptions = {}) {
    this.options = {
      failSilently: true,
      logLevel: "info",
      ...options,
    };

    // Register default adapters
    this.registerAdapter(new EmailAdapter());
    this.registerAdapter(new SlackAdapter());
    this.registerAdapter(new DiscordAdapter());
    this.registerAdapter(new WebhookAdapter());
  }

  /**
   * Register a channel adapter
   */
  registerAdapter(adapter: NotificationChannelAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  /**
   * Get a registered adapter by type
   */
  getAdapter(type: NotificationChannelType): NotificationChannelAdapter | undefined {
    return this.adapters.get(type);
  }

  /**
   * Check if a channel type is supported and configured
   */
  isChannelConfigured(type: NotificationChannelType): boolean {
    const adapter = this.adapters.get(type);
    return adapter?.isConfigured() ?? false;
  }

  /**
   * Get all configured channel routes from config and options
   */
  getRoutes(): ChannelRoute[] {
    const config = getConfig();
    // Config routes need to be filtered to only include supported channel types
    const configRoutes: ChannelRoute[] = (config.channelRoutes || [])
      .filter((r) => ["email", "slack", "discord", "webhook"].includes(r.channel))
      .map((r) => ({
        channel: r.channel as NotificationChannelType,
        target: r.target,
        eventTypes: r.eventTypes,
        actions: r.actions,
        urgencies: r.urgencies,
        enabled: r.enabled,
      }));
    const defaultRoutes = this.options.defaultRoutes || [];
    return [...configRoutes, ...defaultRoutes];
  }

  /**
   * Determine which routes should receive an event
   */
  matchRoutes(event: AgentGateEvent, policyChannels?: string[]): ChannelRoute[] {
    const allRoutes = this.getRoutes();
    const matchedRoutes: ChannelRoute[] = [];

    // If policy specifies channels, create routes for them
    if (policyChannels && policyChannels.length > 0) {
      for (const channelSpec of policyChannels) {
        // Channel spec format: "type:target" (e.g., "slack:#alerts", "email:admin@example.com")
        const colonIndex = channelSpec.indexOf(":");
        if (colonIndex > 0) {
          const type = channelSpec.slice(0, colonIndex) as NotificationChannelType;
          const target = channelSpec.slice(colonIndex + 1);
          if (this.adapters.has(type)) {
            matchedRoutes.push({ channel: type, target, enabled: true });
          }
        }
      }
    }

    // Always check configured routes that match the event
    for (const route of allRoutes) {
      // Skip disabled routes
      if (route.enabled === false) continue;

      // Check if route matches the event
      if (this.routeMatchesEvent(route, event)) {
        matchedRoutes.push(route);
      }
    }

    // Add default channels if no routes matched
    if (matchedRoutes.length === 0) {
      const defaultChannels = this.getDefaultChannels(event);
      matchedRoutes.push(...defaultChannels);
    }

    // Deduplicate by channel+target
    const seen = new Set<string>();
    return matchedRoutes.filter((route) => {
      const key = `${route.channel}:${route.target}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Check if a route matches an event
   */
  private routeMatchesEvent(route: ChannelRoute, event: AgentGateEvent): boolean {
    // Check event type filter
    if (route.eventTypes && route.eventTypes.length > 0) {
      if (!route.eventTypes.includes(event.type)) {
        return false;
      }
    }

    // Use core event filter for actions and urgencies
    const filter: {
      types?: EventName[];
      actions?: string[];
      urgencies?: ApprovalUrgency[];
    } = {};

    if (route.actions && route.actions.length > 0) {
      filter.actions = route.actions;
    }

    if (route.urgencies && route.urgencies.length > 0) {
      filter.urgencies = route.urgencies;
    }

    if (Object.keys(filter).length > 0) {
      return eventMatchesFilter(event, filter);
    }

    return true;
  }

  /**
   * Get default channels for an event
   */
  private getDefaultChannels(_event: AgentGateEvent): ChannelRoute[] {
    const config = getConfig();
    const routes: ChannelRoute[] = [];

    // Add Slack default channel if configured
    if (config.slackBotToken && config.slackDefaultChannel) {
      routes.push({
        channel: "slack",
        target: config.slackDefaultChannel,
        enabled: true,
      });
    }

    // Add Discord default channel if configured
    if (config.discordBotToken && config.discordDefaultChannel) {
      routes.push({
        channel: "discord",
        target: config.discordDefaultChannel,
        enabled: true,
      });
    }

    return routes;
  }

  /**
   * Get fallback channels for a given channel type from config
   */
  private getFallbackChannels(channelType: NotificationChannelType): NotificationChannelType[] {
    const config = getConfig();
    const fallbacks = config.channelFallbacks?.[channelType];
    if (!fallbacks) return [];
    return fallbacks.filter(
      (fb: string): fb is NotificationChannelType => this.adapters.has(fb as NotificationChannelType)
    );
  }

  /**
   * Attempt to send to a specific channel, with health tracking.
   * Returns the result of the send attempt.
   */
  private async sendToChannel(
    channelType: NotificationChannelType,
    target: string,
    event: AgentGateEvent
  ): Promise<NotificationResult> {
    const adapter = this.adapters.get(channelType);
    const tracker = getHealthTracker();

    if (!adapter) {
      return {
        success: false,
        channel: channelType,
        target,
        error: `No adapter registered for channel type: ${channelType}`,
        timestamp: Date.now(),
      };
    }

    try {
      const result = await adapter.send(target, event);

      if (result.success) {
        tracker.recordSuccess(channelType);
      } else {
        tracker.recordFailure(channelType);
      }

      return result;
    } catch (error) {
      tracker.recordFailure(channelType);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        channel: channelType,
        target,
        error: errorMessage,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Dispatch an event to all matching channels
   *
   * @param event - The event to dispatch
   * @param policyChannels - Optional channels from matched policy rule
   * @returns Results from all dispatch attempts
   */
  async dispatch(
    event: AgentGateEvent,
    policyChannels?: string[]
  ): Promise<NotificationResult[]> {
    const routes = this.matchRoutes(event, policyChannels);
    const results: NotificationResult[] = [];
    const tracker = getHealthTracker();

    for (const route of routes) {
      // Check if the primary channel is healthy
      if (!tracker.isHealthy(route.channel)) {
        getLogger().warn(
          `[NotificationDispatcher] Channel "${route.channel}" is unhealthy, attempting fallback`
        );

        // Try fallback channels
        const fallbacks = this.getFallbackChannels(route.channel);
        let delivered = false;

        for (const fallbackChannel of fallbacks) {
          if (!tracker.isHealthy(fallbackChannel)) {
            getLogger().warn(
              `[NotificationDispatcher] Fallback channel "${fallbackChannel}" is also unhealthy, skipping`
            );
            continue;
          }

          const fallbackResult = await this.sendToChannel(fallbackChannel, route.target, event);
          results.push(fallbackResult);

          if (fallbackResult.success) {
            getLogger().info(
              `[NotificationDispatcher] Failover succeeded: ${route.channel} -> ${fallbackChannel}`
            );
            delivered = true;
            break;
          }
        }

        // If no fallback succeeded, still try the original (it might recover)
        if (!delivered) {
          const result = await this.sendToChannel(route.channel, route.target, event);
          results.push(result);

          if (!result.success && this.options.logLevel !== "error") {
            getLogger().warn(
              `[NotificationDispatcher] Failed to deliver to ${route.channel}:${route.target} (all fallbacks exhausted): ${result.error}`
            );
          }

          if (!result.success && !this.options.failSilently) {
            throw new Error(result.error);
          }
        }

        continue;
      }

      // Primary channel is healthy — send directly
      const result = await this.sendToChannel(route.channel, route.target, event);
      results.push(result);

      if (!result.success) {
        if (this.options.logLevel !== "error") {
          getLogger().warn(
            `[NotificationDispatcher] Failed to deliver to ${route.channel}:${route.target}: ${result.error}`
          );
        }

        // Try fallback channels on failure
        const fallbacks = this.getFallbackChannels(route.channel);
        for (const fallbackChannel of fallbacks) {
          if (!tracker.isHealthy(fallbackChannel)) continue;

          const fallbackResult = await this.sendToChannel(fallbackChannel, route.target, event);
          results.push(fallbackResult);

          if (fallbackResult.success) {
            getLogger().info(
              `[NotificationDispatcher] Failover succeeded: ${route.channel} -> ${fallbackChannel}`
            );
            break;
          }
        }

        if (!this.options.failSilently) {
          throw new Error(result.error);
        }
      }
    }

    return results;
  }

  /**
   * Synchronously dispatch an event (fire-and-forget)
   */
  dispatchSync(event: AgentGateEvent, policyChannels?: string[]): void {
    void this.dispatch(event, policyChannels);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalDispatcher: NotificationDispatcher | null = null;

/**
 * Get the global dispatcher instance
 */
export function getGlobalDispatcher(): NotificationDispatcher {
  if (!globalDispatcher) {
    globalDispatcher = new NotificationDispatcher();
  }
  return globalDispatcher;
}

/**
 * Reset the global dispatcher (for testing)
 */
export function resetGlobalDispatcher(): void {
  globalDispatcher = null;
}

/**
 * Create a new dispatcher instance
 */
export function createDispatcher(
  options?: DispatcherOptions
): NotificationDispatcher {
  return new NotificationDispatcher(options);
}
