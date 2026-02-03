// @agentgate/discord - Discord bot for human approvals

import {
  Client,
  GatewayIntentBits,
  Events,
  type Interaction,
  type TextChannel,
  type Message,
} from "discord.js";
import type { ApprovalRequest } from "@agentgate/core";
import {
  buildApprovalEmbed,
  buildDecidedEmbed,
  buildActionRow,
  buildDisabledActionRow,
  type DecisionLinks,
} from "./helpers.js";

export interface DiscordBotOptions {
  /** Discord bot token */
  token: string;
  /** AgentGate server URL (e.g., http://localhost:3000) */
  agentgateUrl: string;
  /** Default channel ID for notifications */
  defaultChannelId?: string;
  /** Whether to include one-click decision links (requires token generation) */
  includeDecisionLinks?: boolean;
}

export interface DiscordBot {
  /** The underlying Discord.js client */
  client: Client;
  /** Send an approval request notification to a channel */
  sendApprovalRequest: (
    request: ApprovalRequest,
    channelId: string,
    options?: { includeLinks?: boolean }
  ) => Promise<string>;
  /** Start the bot */
  start: () => Promise<void>;
  /** Stop the bot */
  stop: () => Promise<void>;
}

/**
 * Fetch decision tokens from AgentGate server
 */
async function fetchDecisionTokens(
  agentgateUrl: string,
  requestId: string
): Promise<DecisionLinks | null> {
  try {
    const response = await fetch(`${agentgateUrl}/api/requests/${requestId}/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      console.warn(`Failed to fetch decision tokens: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as {
      tokens: {
        approve: { url: string };
        deny: { url: string };
      };
    };

    return {
      approve: data.tokens.approve.url,
      deny: data.tokens.deny.url,
    };
  } catch (error) {
    console.warn("Failed to fetch decision tokens:", error);
    return null;
  }
}

/**
 * Create a Discord bot for AgentGate approvals
 */
export function createDiscordBot(options: DiscordBotOptions): DiscordBot {
  const { token, agentgateUrl, defaultChannelId, includeDecisionLinks = true } = options;

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  /**
   * Handle button interactions
   */
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isButton()) return;

    const [action, requestId] = interaction.customId.split(":");
    if (!action || !requestId) return;
    if (action !== "approve" && action !== "deny") return;

    const userId = interaction.user.id;
    const decision = action === "approve" ? "approved" : "denied";

    try {
      // Defer the reply to show loading state
      await interaction.deferUpdate();

      // Call AgentGate API to decide
      const response = await fetch(`${agentgateUrl}/api/requests/${requestId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          decidedBy: userId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `API error: ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }

        await interaction.followUp({
          content: `❌ Failed to ${action} request: ${errorMessage}`,
          ephemeral: true,
        });
        return;
      }

      const request = (await response.json()) as ApprovalRequest;

      // Update the original message
      const updatedEmbed = buildDecidedEmbed(request, decision, userId);
      const disabledRow = buildDisabledActionRow(requestId, decision);

      await interaction.editReply({
        embeds: [updatedEmbed],
        components: [disabledRow],
      });
    } catch (error) {
      console.error(`Failed to ${action} request:`, error);

      try {
        await interaction.followUp({
          content: `❌ Failed to ${action} request: ${error instanceof Error ? error.message : "Unknown error"}`,
          ephemeral: true,
        });
      } catch (followUpError) {
        console.error("Failed to send error followup:", followUpError);
      }
    }
  });

  /**
   * Send an approval request notification to a channel
   */
  async function sendApprovalRequest(
    request: ApprovalRequest,
    channelId: string,
    sendOptions?: { includeLinks?: boolean }
  ): Promise<string> {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Channel ${channelId} not found or is not a text channel`);
    }

    // Fetch decision links if enabled
    let links: DecisionLinks | undefined;
    const shouldIncludeLinks = sendOptions?.includeLinks ?? includeDecisionLinks;
    if (shouldIncludeLinks) {
      const fetchedLinks = await fetchDecisionTokens(agentgateUrl, request.id);
      if (fetchedLinks) {
        links = fetchedLinks;
      }
    }

    const embed = buildApprovalEmbed(request, links);
    const actionRow = buildActionRow(request.id);

    const message: Message = await (channel as TextChannel).send({
      embeds: [embed],
      components: [actionRow],
    });

    return message.id;
  }

  /**
   * Start the Discord bot
   */
  async function start(): Promise<void> {
    return new Promise((resolve, reject) => {
      client.once(Events.ClientReady, (readyClient) => {
        console.log(`⚡️ Discord bot logged in as ${readyClient.user.tag}`);
        if (defaultChannelId) {
          console.log(`   Default channel: ${defaultChannelId}`);
        }
        resolve();
      });

      client.once(Events.Error, reject);

      client.login(token).catch(reject);
    });
  }

  /**
   * Stop the Discord bot
   */
  async function stop(): Promise<void> {
    client.destroy();
    console.log("Discord bot stopped");
  }

  return {
    client,
    sendApprovalRequest,
    start,
    stop,
  };
}
