// @agentgate/slack - Pure helper functions

import type { KnownBlock } from '@slack/types';
import type { ApprovalRequest } from '@agentgate/core';

/**
 * Decision links for one-click approve/deny
 */
export interface DecisionLinks {
  /** URL for approving the request */
  approveUrl: string;
  /** URL for denying the request */
  denyUrl: string;
  /** When the links expire */
  expiresAt?: string;
}

/**
 * Truncate a string to a max length, adding ellipsis if truncated
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Format a JSON object for display in Slack
 */
export function formatJson(obj: Record<string, unknown>, maxLen = 500): string {
  const str = JSON.stringify(obj, null, 2);
  return truncate(str, maxLen);
}

/**
 * Get urgency emoji
 */
export function getUrgencyEmoji(urgency: string): string {
  switch (urgency) {
    case 'critical': return '🔴';
    case 'high': return '🟠';
    case 'normal': return '🟡';
    case 'low': return '🟢';
    default: return '⚪';
  }
}

/**
 * Options for building approval blocks
 */
export interface BuildApprovalBlocksOptions {
  /** Decision links for one-click approve/deny from email/external */
  decisionLinks?: DecisionLinks;
  /** Whether to include interactive buttons (requires Slack bot) */
  includeInteractiveButtons?: boolean;
}

/**
 * Build Block Kit message for an approval request
 */
export function buildApprovalBlocks(
  request: ApprovalRequest,
  options: BuildApprovalBlocksOptions = {}
): KnownBlock[] {
  const { decisionLinks, includeInteractiveButtons = true } = options;
  
  const createdAt = request.createdAt instanceof Date 
    ? request.createdAt.toISOString() 
    : request.createdAt;
  
  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '🔔 Approval Request',
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Action:*\n\`${request.action}\``,
        },
        {
          type: 'mrkdwn',
          text: `*Urgency:*\n${getUrgencyEmoji(request.urgency)} ${request.urgency}`,
        },
        {
          type: 'mrkdwn',
          text: `*Request ID:*\n\`${request.id}\``,
        },
        {
          type: 'mrkdwn',
          text: `*Created:*\n${createdAt}`,
        },
      ],
    },
  ];

  // Add params if present
  if (request.params && Object.keys(request.params).length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Parameters:*\n\`\`\`${formatJson(request.params)}\`\`\``,
      },
    });
  }

  // Add context if present
  if (request.context && Object.keys(request.context).length > 0) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `📋 Context: ${truncate(JSON.stringify(request.context), 200)}`,
        },
      ],
    });
  }

  // Add divider before buttons
  blocks.push({ type: 'divider' });

  // Add action buttons (interactive if available, link buttons if we have decision links)
  if (includeInteractiveButtons) {
    // Interactive buttons that work with the Slack bot
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '✅ Approve',
            emoji: true,
          },
          style: 'primary',
          action_id: `approve_${request.id}`,
          value: request.id,
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '❌ Deny',
            emoji: true,
          },
          style: 'danger',
          action_id: `deny_${request.id}`,
          value: request.id,
        },
      ],
    });
  }

  // Add one-click link buttons if decision links are provided
  if (decisionLinks) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '🔗 Approve (one-click)',
            emoji: true,
          },
          url: decisionLinks.approveUrl,
          action_id: `link_approve_${request.id}`,
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '🔗 Deny (one-click)',
            emoji: true,
          },
          url: decisionLinks.denyUrl,
          action_id: `link_deny_${request.id}`,
        },
      ],
    });

    // Add expiry note if provided
    if (decisionLinks.expiresAt) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `⏰ One-click links expire: ${decisionLinks.expiresAt}`,
          },
        ],
      });
    }
  }

  return blocks;
}

/**
 * Build Block Kit message for a decided request
 */
export function buildDecidedBlocks(
  request: ApprovalRequest,
  decision: 'approved' | 'denied',
  userId: string
): KnownBlock[] {
  const emoji = decision === 'approved' ? '✅' : '❌';
  const verb = decision === 'approved' ? 'Approved' : 'Denied';
  
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${emoji} Request ${verb}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Action:*\n\`${request.action}\``,
        },
        {
          type: 'mrkdwn',
          text: `*Decision:*\n${verb} by <@${userId}>`,
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Request ID: \`${request.id}\``,
        },
      ],
    },
  ];
}
