/**
 * Slack notification adapter
 *
 * Sends notifications to Slack channels via the Web API.
 * Uses Block Kit for rich message formatting.
 */

import type { AgentGateEvent } from "@agentgate/core";
import type { NotificationChannelAdapter, NotificationResult } from "../types.js";
import { getConfig } from "../../../config.js";
import { generateDecisionTokens } from "../../decision-tokens.js";

/**
 * Decision links for one-click approve/deny
 */
export interface DecisionLinks {
  approveUrl: string;
  denyUrl: string;
  expiresAt: string;
}

/**
 * Get urgency emoji for Slack messages
 */
export function getUrgencyEmoji(urgency: string): string {
  switch (urgency) {
    case "critical":
      return "🔴";
    case "high":
      return "🟠";
    case "normal":
      return "🟡";
    case "low":
      return "🟢";
    default:
      return "⚪";
  }
}

/**
 * Format JSON for display in Slack (truncated)
 */
export function formatJson(obj: Record<string, unknown>, maxLen = 500): string {
  const str = JSON.stringify(obj, null, 2);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

/**
 * Options for building Slack blocks
 */
export interface BuildSlackBlocksOptions {
  /** Decision links for one-click approve/deny */
  decisionLinks?: DecisionLinks;
  /** Whether to include interactive buttons (requires Slack bot) */
  includeInteractiveButtons?: boolean;
}

/**
 * Build Slack blocks for a request created event
 */
export function buildRequestCreatedBlocks(
  event: Extract<AgentGateEvent, { type: "request.created" }>,
  options: BuildSlackBlocksOptions = {}
): unknown[] {
  const { payload } = event;
  const { decisionLinks, includeInteractiveButtons = true } = options;
  
  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🔔 Approval Request",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Action:*\n\`${payload.action}\``,
        },
        {
          type: "mrkdwn",
          text: `*Urgency:*\n${getUrgencyEmoji(payload.urgency)} ${payload.urgency}`,
        },
        {
          type: "mrkdwn",
          text: `*Request ID:*\n\`${payload.requestId}\``,
        },
        {
          type: "mrkdwn",
          text: `*Created:*\n${new Date(event.timestamp).toISOString()}`,
        },
      ],
    },
  ];

  // Add params if present
  if (payload.params && Object.keys(payload.params).length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Parameters:*\n\`\`\`${formatJson(payload.params as Record<string, unknown>)}\`\`\``,
      },
    });
  }

  // Add context if present
  if (payload.context && Object.keys(payload.context).length > 0) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `📋 Context: ${formatJson(payload.context as Record<string, unknown>, 200)}`,
        },
      ],
    });
  }

  // Add policy decision if present
  if (payload.policyDecision) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `🤖 Policy decision: *${payload.policyDecision.decision}*${
            payload.policyDecision.policyId
              ? ` (policy: ${payload.policyDecision.policyId})`
              : ""
          }`,
        },
      ],
    });
  }

  // Add divider before buttons
  blocks.push({ type: "divider" });

  // Add interactive action buttons (work with Slack bot)
  if (includeInteractiveButtons) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "✅ Approve",
            emoji: true,
          },
          style: "primary",
          action_id: `approve_${payload.requestId}`,
          value: payload.requestId,
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "❌ Deny",
            emoji: true,
          },
          style: "danger",
          action_id: `deny_${payload.requestId}`,
          value: payload.requestId,
        },
      ],
    });
  }

  // Add one-click link buttons if decision links are provided
  if (decisionLinks) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "🔗 Approve (one-click)",
            emoji: true,
          },
          url: decisionLinks.approveUrl,
          action_id: `link_approve_${payload.requestId}`,
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "🔗 Deny (one-click)",
            emoji: true,
          },
          url: decisionLinks.denyUrl,
          action_id: `link_deny_${payload.requestId}`,
        },
      ],
    });

    // Add expiry note
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `⏰ One-click links expire: ${decisionLinks.expiresAt}`,
        },
      ],
    });
  }

  return blocks;
}

/**
 * Build Slack blocks for a request decided event
 */
export function buildRequestDecidedBlocks(
  event: Extract<AgentGateEvent, { type: "request.decided" }>
): unknown[] {
  const { payload } = event;
  const isApproved = payload.status === "approved";
  const emoji = isApproved ? "✅" : "❌";
  const statusText = isApproved ? "Approved" : "Denied";

  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${emoji} Request ${statusText}`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Action:*\n\`${payload.action}\``,
        },
        {
          type: "mrkdwn",
          text: `*Decided by:*\n${payload.decidedBy} (${payload.decidedByType})`,
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Request ID: \`${payload.requestId}\` • Decision time: ${(payload.decisionTimeMs / 1000).toFixed(1)}s${
            payload.reason ? ` • Reason: ${payload.reason}` : ""
          }`,
        },
      ],
    },
  ];
}

/**
 * Build Slack blocks for any event (generic fallback)
 */
export function buildGenericBlocks(event: AgentGateEvent): unknown[] {
  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `📢 ${event.type}`,
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `\`\`\`${JSON.stringify(event, null, 2).slice(0, 2900)}\`\`\``,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Event ID: ${event.eventId} • Source: ${event.source}`,
        },
      ],
    },
  ];
}

/**
 * Build Slack blocks for an event
 */
export function buildSlackBlocks(
  event: AgentGateEvent,
  options: BuildSlackBlocksOptions = {}
): unknown[] {
  switch (event.type) {
    case "request.created":
      return buildRequestCreatedBlocks(event, options);
    case "request.decided":
      return buildRequestDecidedBlocks(event);
    default:
      return buildGenericBlocks(event);
  }
}

/**
 * Slack notification adapter
 */
export class SlackAdapter implements NotificationChannelAdapter {
  readonly type = "slack" as const;

  isConfigured(): boolean {
    const config = getConfig();
    return Boolean(config.slackBotToken);
  }

  async send(target: string, event: AgentGateEvent): Promise<NotificationResult> {
    const config = getConfig();
    const timestamp = Date.now();

    if (!this.isConfigured()) {
      return {
        success: false,
        channel: this.type,
        target,
        error: "Slack not configured (missing SLACK_BOT_TOKEN)",
        timestamp,
      };
    }

    try {
      // Generate decision tokens for request.created events
      let decisionLinks: DecisionLinks | undefined;
      if (event.type === "request.created") {
        const tokens = await generateDecisionTokens(event.payload.requestId);
        if (tokens) {
          decisionLinks = {
            approveUrl: tokens.approve.url,
            denyUrl: tokens.deny.url,
            expiresAt: tokens.expiresAt,
          };
        }
      }

      const blocks = buildSlackBlocks(event, { decisionLinks });

      // Use fetch for Slack API to avoid adding dependencies
      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.slackBotToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: target,
          blocks,
          text: `AgentGate: ${event.type}`, // Fallback text
        }),
      });

      const result = await response.json() as { ok: boolean; error?: string; ts?: string };

      if (!result.ok) {
        return {
          success: false,
          channel: this.type,
          target,
          error: result.error || "Unknown Slack API error",
          timestamp,
        };
      }

      return {
        success: true,
        channel: this.type,
        target,
        timestamp,
        response: { ts: result.ts },
      };
    } catch (error) {
      return {
        success: false,
        channel: this.type,
        target,
        error: error instanceof Error ? error.message : "Unknown Slack error",
        timestamp,
      };
    }
  }
}
