# @agentkitai/agentgate-discord

Discord bot integration for AgentGate - receive approval requests and make decisions directly from Discord.

## Features

- 📬 Rich embeds for approval requests with all details
- 🔗 One-click approve/deny links (no authentication required)
- 🔘 Interactive buttons for approve/deny (requires bot interaction)
- ⚡ Real-time updates when decisions are made
- 🎨 Color-coded urgency levels

## Installation

```bash
pnpm add @agentkitai/agentgate-discord
# or
npm install @agentkitai/agentgate-discord
```

## Configuration

Set the following environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | ✅ | Discord bot token (from Discord Developer Portal) |
| `AGENTGATE_URL` | ❌ | AgentGate server URL (default: `http://localhost:3000`) |
| `DISCORD_CHANNEL_ID` | ❌ | Default channel ID for notifications |
| `DISCORD_INCLUDE_LINKS` | ❌ | Include one-click links (default: `true`) |

## Usage

### Standalone Mode

Run the bot as a standalone service:

```bash
# With environment variables
DISCORD_BOT_TOKEN=your-token AGENTGATE_URL=http://localhost:3000 pnpm start

# Or with .env file
pnpm start
```

### Programmatic Usage

```typescript
import { createDiscordBot } from '@agentkitai/agentgate-discord';

const bot = createDiscordBot({
  token: process.env.DISCORD_BOT_TOKEN!,
  agentgateUrl: 'http://localhost:3000',
  defaultChannelId: '123456789012345678',
  includeDecisionLinks: true,
});

await bot.start();

// Send an approval request to a specific channel
const messageId = await bot.sendApprovalRequest(
  {
    id: 'req-123',
    action: 'delete_file',
    params: { path: '/important/file.txt' },
    context: { user: 'agent-1' },
    urgency: 'high',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  '987654321098765432'
);

// Graceful shutdown
process.on('SIGINT', () => bot.stop());
```

## Discord Bot Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section and create a bot
4. Copy the bot token
5. Enable the required intents (Message Content is optional)
6. Go to "OAuth2" → "URL Generator"
7. Select scopes: `bot`, `applications.commands`
8. Select permissions: `Send Messages`, `Embed Links`, `Use External Emojis`
9. Use the generated URL to invite the bot to your server

## Message Format

The bot sends rich embeds with:

- **Action**: The requested action name
- **Urgency**: Color-coded urgency level (🔴 Critical, 🟠 High, 🟡 Normal, 🟢 Low)
- **Request ID**: Unique identifier
- **Parameters**: JSON-formatted parameters (if any)
- **Context**: Additional context (if any)
- **One-Click Links**: Direct approve/deny URLs (if enabled)

Interactive buttons allow users to approve or deny directly from Discord.

## Integration with AgentGate Server

The bot integrates with AgentGate's notification system. Configure the server to send notifications to Discord:

```bash
# Server environment variables
DISCORD_BOT_TOKEN=your-token
DISCORD_DEFAULT_CHANNEL=123456789012345678
CHANNEL_ROUTES='[{"channel":"discord","target":"123456789012345678","enabled":true}]'
```

## API

### `createDiscordBot(options)`

Creates a new Discord bot instance.

**Options:**
- `token` (string, required): Discord bot token
- `agentgateUrl` (string, required): AgentGate server URL
- `defaultChannelId` (string, optional): Default channel for notifications
- `includeDecisionLinks` (boolean, optional): Include one-click links (default: true)

**Returns:** `DiscordBot` instance

### `DiscordBot`

- `client`: The underlying Discord.js Client
- `start()`: Start the bot
- `stop()`: Stop the bot
- `sendApprovalRequest(request, channelId, options?)`: Send an approval request

### Helper Functions

```typescript
import {
  buildApprovalEmbed,
  buildDecidedEmbed,
  buildActionRow,
  getUrgencyEmoji,
  getUrgencyColor,
  EMBED_COLORS,
} from '@agentkitai/agentgate-discord';
```

## License

MIT
