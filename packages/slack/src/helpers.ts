// @agentkitai/agentgate-slack - Pure helper functions

import type { KnownBlock } from '@slack/types';
import type { ApprovalRequest, DecisionLinks } from '@agentkitai/agentgate-core';
import { truncate, formatJson, getUrgencyEmoji } from '@agentkitai/agentgate-core';

export type { DecisionLinks } from '@agentkitai/agentgate-core';
export { truncate, formatJson, getUrgencyEmoji } from '@agentkitai/agentgate-core';

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
