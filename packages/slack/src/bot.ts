// @agentgate/slack - Slack bot for human approvals

import { App, type BlockAction } from '@slack/bolt';
import type { ApprovalRequest } from '@agentgate/core';
import { buildApprovalBlocks, buildDecidedBlocks } from './helpers.js';

export interface SlackBotOptions {
  /** Slack bot token (xoxb-...) */
  token: string;
  /** Slack signing secret */
  signingSecret: string;
  /** AgentGate server URL (e.g., http://localhost:3000) */
  agentgateUrl: string;
  /** Default channel for notifications */
  defaultChannel?: string;
  /** Port to listen on (default: 3001) */
  port?: number;
}

export interface SlackBot {
  /** The underlying Bolt app */
  app: App;
  /** Send an approval request notification to a channel */
  sendApprovalRequest: (request: ApprovalRequest, channel: string) => Promise<string>;
  /** Start the bot */
  start: () => Promise<void>;
  /** Stop the bot */
  stop: () => Promise<void>;
}

/**
 * Create a Slack bot for AgentGate approvals
 */
export function createSlackBot(options: SlackBotOptions): SlackBot {
  const { token, signingSecret, agentgateUrl, port = 3001 } = options;

  const app = new App({
    token,
    signingSecret,
  });

  /**
   * Handle approval button clicks
   */
  app.action<BlockAction>(/^approve_/, async ({ action, ack, body, client, logger }) => {
    await ack();

    if (!('value' in action)) {
      logger.error('Action missing value');
      return;
    }

    const requestId = action.value;
    const userId = body.user.id;

    try {
      // Call AgentGate API to approve
      const response = await fetch(`${agentgateUrl}/api/requests/${requestId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'approved',
          decidedBy: userId,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error: ${response.status} ${error}`);
      }

      const request = await response.json() as ApprovalRequest;

      // Update the original message
      if (body.channel?.id && body.message?.ts) {
        await client.chat.update({
          channel: body.channel.id,
          ts: body.message.ts,
          blocks: buildDecidedBlocks(request, 'approved', userId),
          text: `Request ${requestId} approved by <@${userId}>`,
        });
      }
    } catch (error) {
      logger.error('Failed to approve request:', error);
      
      // Send ephemeral error message
      if (body.channel?.id) {
        await client.chat.postEphemeral({
          channel: body.channel.id,
          user: userId,
          text: `❌ Failed to approve request: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }
  });

  /**
   * Handle deny button clicks
   */
  app.action<BlockAction>(/^deny_/, async ({ action, ack, body, client, logger }) => {
    await ack();

    if (!('value' in action)) {
      logger.error('Action missing value');
      return;
    }

    const requestId = action.value;
    const userId = body.user.id;

    try {
      // Call AgentGate API to deny
      const response = await fetch(`${agentgateUrl}/api/requests/${requestId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'denied',
          decidedBy: userId,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error: ${response.status} ${error}`);
      }

      const request = await response.json() as ApprovalRequest;

      // Update the original message
      if (body.channel?.id && body.message?.ts) {
        await client.chat.update({
          channel: body.channel.id,
          ts: body.message.ts,
          blocks: buildDecidedBlocks(request, 'denied', userId),
          text: `Request ${requestId} denied by <@${userId}>`,
        });
      }
    } catch (error) {
      logger.error('Failed to deny request:', error);
      
      // Send ephemeral error message
      if (body.channel?.id) {
        await client.chat.postEphemeral({
          channel: body.channel.id,
          user: userId,
          text: `❌ Failed to deny request: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }
  });

  /**
   * Send an approval request notification to a channel
   */
  async function sendApprovalRequest(request: ApprovalRequest, channel: string): Promise<string> {
    const result = await app.client.chat.postMessage({
      channel,
      blocks: buildApprovalBlocks(request),
      text: `New approval request: ${request.action} (${request.urgency} urgency)`,
    });

    if (!result.ts) {
      throw new Error('Failed to send message: no timestamp returned');
    }

    return result.ts;
  }

  /**
   * Start the Slack bot
   */
  async function start(): Promise<void> {
    await app.start(port);
    console.log(`⚡️ Slack bot is running on port ${port}`);
  }

  /**
   * Stop the Slack bot
   */
  async function stop(): Promise<void> {
    await app.stop();
    console.log('Slack bot stopped');
  }

  return {
    app,
    sendApprovalRequest,
    start,
    stop,
  };
}
