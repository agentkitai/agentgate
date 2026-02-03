// @agentgate/slack - Pure helper functions

import type { KnownBlock } from '@slack/types';
import type { ApprovalRequest } from '@agentgate/core';

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
 * Build Block Kit message for an approval request
 */
export function buildApprovalBlocks(request: ApprovalRequest): KnownBlock[] {
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

  // Add action buttons
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
