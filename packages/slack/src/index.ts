// @agentgate/slack - Slack bot integration

import 'dotenv/config';
import { createSlackBot, type SlackBot, type SlackBotOptions } from './bot.js';
export {
  truncate,
  formatJson,
  getUrgencyEmoji,
  buildApprovalBlocks,
  buildDecidedBlocks,
} from './helpers.js';

export { createSlackBot, type SlackBot, type SlackBotOptions };

/**
 * Standalone runner - starts the bot when run directly
 */
async function main() {
  const token = process.env.SLACK_BOT_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const agentgateUrl = process.env.AGENTGATE_URL || 'http://localhost:3000';
  const defaultChannel = process.env.SLACK_DEFAULT_CHANNEL;
  const port = parseInt(process.env.SLACK_BOT_PORT || '3001', 10);

  if (!token) {
    console.error('❌ Missing SLACK_BOT_TOKEN environment variable');
    process.exit(1);
  }

  if (!signingSecret) {
    console.error('❌ Missing SLACK_SIGNING_SECRET environment variable');
    process.exit(1);
  }

  console.log('🚀 Starting AgentGate Slack bot...');
  console.log(`   AgentGate URL: ${agentgateUrl}`);
  console.log(`   Port: ${port}`);
  if (defaultChannel) {
    console.log(`   Default channel: ${defaultChannel}`);
  }

  const bot = createSlackBot({
    token,
    signingSecret,
    agentgateUrl,
    defaultChannel,
    port,
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    await bot.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down...');
    await bot.stop();
    process.exit(0);
  });

  await bot.start();
}

// Run if executed directly (not imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
