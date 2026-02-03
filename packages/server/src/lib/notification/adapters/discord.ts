/**
 * Discord notification adapter
 *
 * Sends notifications to Discord channels via webhooks or the bot API.
 * Uses embeds for rich message formatting.
 */

import type { AgentGateEvent } from "@agentgate/core";
import type { NotificationChannelAdapter, NotificationResult } from "../types.js";
import { getConfig } from "../../../config.js";

/**
 * Discord embed colors by urgency/status
 */
const COLORS = {
  low: 0x22c55e, // Green
  normal: 0xeab308, // Yellow
  high: 0xf97316, // Orange
  critical: 0xef4444, // Red
  approved: 0x22c55e, // Green
  denied: 0xef4444, // Red
  default: 0x6b7280, // Gray
} as const;

/**
 * Get color for an event
 */
export function getEventColor(event: AgentGateEvent): number {
  if ("payload" in event) {
    if ("status" in event.payload) {
      const status = event.payload.status as string;
      if (status === "approved") return COLORS.approved;
      if (status === "denied") return COLORS.denied;
    }
    if ("urgency" in event.payload) {
      const urgency = event.payload.urgency as keyof typeof COLORS;
      return COLORS[urgency] || COLORS.default;
    }
  }
  return COLORS.default;
}

/**
 * Build Discord embed for request created event
 */
export function buildRequestCreatedEmbed(
  event: Extract<AgentGateEvent, { type: "request.created" }>
): object {
  const { payload } = event;
  const fields = [
    {
      name: "Action",
      value: `\`${payload.action}\``,
      inline: true,
    },
    {
      name: "Urgency",
      value: payload.urgency.toUpperCase(),
      inline: true,
    },
    {
      name: "Request ID",
      value: `\`${payload.requestId}\``,
      inline: true,
    },
  ];

  if (payload.params && Object.keys(payload.params).length > 0) {
    const paramsStr = JSON.stringify(payload.params, null, 2);
    fields.push({
      name: "Parameters",
      value: `\`\`\`json\n${paramsStr.slice(0, 1000)}\`\`\``,
      inline: false,
    });
  }

  if (payload.policyDecision) {
    fields.push({
      name: "Policy Decision",
      value: `${payload.policyDecision.decision}${
        payload.policyDecision.policyId
          ? ` (${payload.policyDecision.policyId})`
          : ""
      }`,
      inline: true,
    });
  }

  return {
    title: "🔔 Approval Request",
    color: getEventColor(event),
    fields,
    timestamp: new Date(event.timestamp).toISOString(),
    footer: {
      text: `Event ID: ${event.eventId}`,
    },
  };
}

/**
 * Build Discord embed for request decided event
 */
export function buildRequestDecidedEmbed(
  event: Extract<AgentGateEvent, { type: "request.decided" }>
): object {
  const { payload } = event;
  const isApproved = payload.status === "approved";
  const emoji = isApproved ? "✅" : "❌";

  const fields = [
    {
      name: "Action",
      value: `\`${payload.action}\``,
      inline: true,
    },
    {
      name: "Status",
      value: payload.status.toUpperCase(),
      inline: true,
    },
    {
      name: "Decided By",
      value: `${payload.decidedBy} (${payload.decidedByType})`,
      inline: true,
    },
    {
      name: "Decision Time",
      value: `${(payload.decisionTimeMs / 1000).toFixed(1)}s`,
      inline: true,
    },
  ];

  if (payload.reason) {
    fields.push({
      name: "Reason",
      value: payload.reason,
      inline: false,
    });
  }

  return {
    title: `${emoji} Request ${isApproved ? "Approved" : "Denied"}`,
    color: getEventColor(event),
    fields,
    timestamp: new Date(event.timestamp).toISOString(),
    footer: {
      text: `Request ID: ${payload.requestId}`,
    },
  };
}

/**
 * Build generic Discord embed for any event
 */
export function buildGenericEmbed(event: AgentGateEvent): object {
  const payload = "payload" in event ? event.payload : {};
  const payloadStr = JSON.stringify(payload, null, 2);

  return {
    title: `📢 ${event.type}`,
    color: getEventColor(event),
    description: `\`\`\`json\n${payloadStr.slice(0, 2000)}\`\`\``,
    timestamp: new Date(event.timestamp).toISOString(),
    footer: {
      text: `Event ID: ${event.eventId} • Source: ${event.source}`,
    },
  };
}

/**
 * Build Discord embed for an event
 */
export function buildDiscordEmbed(event: AgentGateEvent): object {
  switch (event.type) {
    case "request.created":
      return buildRequestCreatedEmbed(event);
    case "request.decided":
      return buildRequestDecidedEmbed(event);
    default:
      return buildGenericEmbed(event);
  }
}

/**
 * Discord notification adapter
 */
export class DiscordAdapter implements NotificationChannelAdapter {
  readonly type = "discord" as const;

  isConfigured(): boolean {
    const config = getConfig();
    return Boolean(config.discordBotToken);
  }

  async send(target: string, event: AgentGateEvent): Promise<NotificationResult> {
    const config = getConfig();
    const timestamp = Date.now();

    // Check if target is a webhook URL
    if (target.startsWith("https://discord.com/api/webhooks/")) {
      return this.sendViaWebhook(target, event, timestamp);
    }

    // Otherwise use bot API
    if (!this.isConfigured()) {
      return {
        success: false,
        channel: this.type,
        target,
        error: "Discord not configured (missing DISCORD_BOT_TOKEN and target is not a webhook URL)",
        timestamp,
      };
    }

    try {
      const embed = buildDiscordEmbed(event);

      const response = await fetch(
        `https://discord.com/api/v10/channels/${target}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bot ${config.discordBotToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            embeds: [embed],
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          channel: this.type,
          target,
          error: `Discord API error: ${response.status} ${error}`,
          timestamp,
        };
      }

      const result = await response.json() as { id: string };

      return {
        success: true,
        channel: this.type,
        target,
        timestamp,
        response: { messageId: result.id },
      };
    } catch (error) {
      return {
        success: false,
        channel: this.type,
        target,
        error: error instanceof Error ? error.message : "Unknown Discord error",
        timestamp,
      };
    }
  }

  private async sendViaWebhook(
    webhookUrl: string,
    event: AgentGateEvent,
    timestamp: number
  ): Promise<NotificationResult> {
    try {
      const embed = buildDiscordEmbed(event);

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: "AgentGate",
          embeds: [embed],
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          channel: this.type,
          target: webhookUrl,
          error: `Discord webhook error: ${response.status} ${error}`,
          timestamp,
        };
      }

      return {
        success: true,
        channel: this.type,
        target: webhookUrl,
        timestamp,
      };
    } catch (error) {
      return {
        success: false,
        channel: this.type,
        target: webhookUrl,
        error: error instanceof Error ? error.message : "Unknown Discord webhook error",
        timestamp,
      };
    }
  }
}
