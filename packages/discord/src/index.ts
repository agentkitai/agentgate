// @agentgate/discord - Discord bot integration

import "dotenv/config";
import { createDiscordBot, type DiscordBot, type DiscordBotOptions } from "./bot.js";

export {
  truncate,
  formatJson,
  getUrgencyEmoji,
  getUrgencyColor,
  buildApprovalEmbed,
  buildDecidedEmbed,
  buildActionRow,
  buildDisabledActionRow,
  EMBED_COLORS,
  type DecisionLinks,
} from "./helpers.js";

export { createDiscordBot, type DiscordBot, type DiscordBotOptions };

/**
 * Standalone runner - starts the bot when run directly
 */
async function main() {
  const token = process.env.DISCORD_BOT_TOKEN;
  const agentgateUrl = process.env.AGENTGATE_URL || "http://localhost:3000";
  const defaultChannelId = process.env.DISCORD_CHANNEL_ID;
  const includeLinks = process.env.DISCORD_INCLUDE_LINKS !== "false";

  if (!token) {
    console.error("❌ Missing DISCORD_BOT_TOKEN environment variable");
    process.exit(1);
  }

  console.log("🚀 Starting AgentGate Discord bot...");
  console.log(`   AgentGate URL: ${agentgateUrl}`);
  console.log(`   Include decision links: ${includeLinks}`);
  if (defaultChannelId) {
    console.log(`   Default channel: ${defaultChannelId}`);
  }

  const bot = createDiscordBot({
    token,
    agentgateUrl,
    defaultChannelId,
    includeDecisionLinks: includeLinks,
  });

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n🛑 Shutting down...");
    await bot.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\n🛑 Shutting down...");
    await bot.stop();
    process.exit(0);
  });

  await bot.start();
}

// Run if executed directly (not imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
