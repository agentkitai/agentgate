// @agentgate/discord - Pure helper functions

import type { ApprovalRequest, ApprovalUrgency } from "@agentgate/core";
import type { APIEmbed, APIEmbedField, APIActionRowComponent, APIButtonComponent } from "discord.js";

/**
 * Embed colors by urgency/status
 */
export const EMBED_COLORS = {
  low: 0x22c55e, // Green
  normal: 0xeab308, // Yellow
  high: 0xf97316, // Orange
  critical: 0xef4444, // Red
  approved: 0x22c55e, // Green
  denied: 0xef4444, // Red
  default: 0x6b7280, // Gray
} as const;

/**
 * Truncate a string to a max length, adding ellipsis if truncated
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

/**
 * Format a JSON object for display in Discord code blocks
 */
export function formatJson(obj: Record<string, unknown>, maxLen = 1000): string {
  const str = JSON.stringify(obj, null, 2);
  return truncate(str, maxLen);
}

/**
 * Get urgency emoji
 */
export function getUrgencyEmoji(urgency: ApprovalUrgency | string): string {
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
 * Get embed color for urgency
 */
export function getUrgencyColor(urgency: ApprovalUrgency | string): number {
  return EMBED_COLORS[urgency as keyof typeof EMBED_COLORS] || EMBED_COLORS.default;
}

/**
 * Decision links for approve/deny actions
 */
export interface DecisionLinks {
  approve: string;
  deny: string;
}

/**
 * Build Discord embed for an approval request
 */
export function buildApprovalEmbed(
  request: ApprovalRequest,
  links?: DecisionLinks
): APIEmbed {
  const createdAt =
    request.createdAt instanceof Date
      ? request.createdAt.toISOString()
      : request.createdAt;

  const fields: APIEmbedField[] = [
    {
      name: "Action",
      value: `\`${request.action}\``,
      inline: true,
    },
    {
      name: "Urgency",
      value: `${getUrgencyEmoji(request.urgency)} ${request.urgency.toUpperCase()}`,
      inline: true,
    },
    {
      name: "Request ID",
      value: `\`${request.id}\``,
      inline: true,
    },
    {
      name: "Created",
      value: `<t:${Math.floor(new Date(createdAt).getTime() / 1000)}:R>`,
      inline: true,
    },
  ];

  // Add params if present
  if (request.params && Object.keys(request.params).length > 0) {
    fields.push({
      name: "Parameters",
      value: `\`\`\`json\n${formatJson(request.params)}\`\`\``,
      inline: false,
    });
  }

  // Add context if present
  if (request.context && Object.keys(request.context).length > 0) {
    fields.push({
      name: "Context",
      value: `\`\`\`json\n${formatJson(request.context, 500)}\`\`\``,
      inline: false,
    });
  }

  // Add one-click links if provided
  if (links) {
    fields.push({
      name: "🔗 One-Click Decision Links",
      value: `[✅ Approve](${links.approve}) | [❌ Deny](${links.deny})`,
      inline: false,
    });
  }

  return {
    title: "🔔 Approval Request",
    color: getUrgencyColor(request.urgency),
    fields,
    timestamp: createdAt,
    footer: {
      text: `AgentGate • Request ${request.id}`,
    },
  };
}

/**
 * Build Discord embed for a decided request
 */
export function buildDecidedEmbed(
  request: ApprovalRequest,
  decision: "approved" | "denied",
  decidedBy: string
): APIEmbed {
  const isApproved = decision === "approved";
  const emoji = isApproved ? "✅" : "❌";
  const statusText = isApproved ? "Approved" : "Denied";
  const color = isApproved ? EMBED_COLORS.approved : EMBED_COLORS.denied;

  const decidedAt =
    request.decidedAt instanceof Date
      ? request.decidedAt.toISOString()
      : request.decidedAt || new Date().toISOString();

  const fields: APIEmbedField[] = [
    {
      name: "Action",
      value: `\`${request.action}\``,
      inline: true,
    },
    {
      name: "Decision",
      value: `${emoji} ${statusText}`,
      inline: true,
    },
    {
      name: "Decided By",
      value: decidedBy.startsWith("U") || /^\d+$/.test(decidedBy) 
        ? `<@${decidedBy}>` 
        : decidedBy,
      inline: true,
    },
  ];

  if (request.decisionReason) {
    fields.push({
      name: "Reason",
      value: request.decisionReason,
      inline: false,
    });
  }

  return {
    title: `${emoji} Request ${statusText}`,
    color,
    fields,
    timestamp: decidedAt,
    footer: {
      text: `AgentGate • Request ${request.id}`,
    },
  };
}

/**
 * Build action row with approve/deny buttons
 */
export function buildActionRow(
  requestId: string
): APIActionRowComponent<APIButtonComponent> {
  return {
    type: 1, // ACTION_ROW
    components: [
      {
        type: 2, // BUTTON
        style: 3, // SUCCESS (green)
        label: "Approve",
        emoji: { name: "✅" },
        custom_id: `approve:${requestId}`,
      },
      {
        type: 2, // BUTTON
        style: 4, // DANGER (red)
        label: "Deny",
        emoji: { name: "❌" },
        custom_id: `deny:${requestId}`,
      },
    ],
  };
}

/**
 * Build disabled action row (for decided requests)
 */
export function buildDisabledActionRow(
  requestId: string,
  decision: "approved" | "denied"
): APIActionRowComponent<APIButtonComponent> {
  return {
    type: 1, // ACTION_ROW
    components: [
      {
        type: 2, // BUTTON
        style: decision === "approved" ? 3 : 2, // SUCCESS if approved, SECONDARY otherwise
        label: "Approved",
        emoji: { name: "✅" },
        custom_id: `approve:${requestId}`,
        disabled: true,
      },
      {
        type: 2, // BUTTON
        style: decision === "denied" ? 4 : 2, // DANGER if denied, SECONDARY otherwise
        label: "Denied",
        emoji: { name: "❌" },
        custom_id: `deny:${requestId}`,
        disabled: true,
      },
    ],
  };
}
