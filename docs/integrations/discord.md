# Discord Integration

Send approval requests to Discord channels and receive decisions via button interactions.

## Features

- 📣 Posts approval requests with embeds
- ✅ Interactive Approve/Deny buttons
- 🔄 Updates messages after decision
- 🎨 Color-coded by urgency

## Discord Bot Setup

### 1. Create a Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**
3. Name it (e.g., "AgentGate Approvals")

### 2. Create a Bot

1. Go to the **Bot** section
2. Click **Add Bot**
3. Copy the **Token** (you'll need this)

### 3. Configure Permissions

Under **OAuth2 → URL Generator**:

1. Select scopes: `bot`, `applications.commands`
2. Select permissions:
   - Send Messages
   - Embed Links
   - Use Slash Commands
   - Read Message History

### 4. Invite to Server

1. Copy the generated URL
2. Open in browser and select your server
3. Authorize the bot

### 5. Get Channel ID

1. Enable Developer Mode in Discord (Settings → Advanced)
2. Right-click the target channel → Copy ID

## Configuration

```bash
# Required
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_DEFAULT_CHANNEL=123456789012345678  # Channel ID

# Optional
AGENTGATE_URL=http://localhost:3000
```

## Running

### With Docker

```bash
# Set credentials in .env
docker-compose --profile bots up -d
```

### Standalone

```bash
DISCORD_BOT_TOKEN=... \
DISCORD_DEFAULT_CHANNEL=... \
AGENTGATE_URL=http://localhost:3000 \
npx @agentgate/discord
```

## Message Format

Requests appear as rich embeds:

```
┌─────────────────────────────────────┐
│ 🔔 Approval Request                 │
├─────────────────────────────────────┤
│ Action: send_email                  │
│ Urgency: 🟡 Normal                  │
│ Request ID: req_abc123              │
│                                     │
│ Parameters:                         │
│ {                                   │
│   "to": "user@example.com"          │
│ }                                   │
│                                     │
│ [✅ Approve] [❌ Deny]              │
└─────────────────────────────────────┘
```

Urgency colors:
- 🟢 Low — Green
- 🟡 Normal — Yellow
- 🟠 High — Orange
- 🔴 Critical — Red

## Channel Routing

Route to specific channels:

```bash
export CHANNEL_ROUTES='[
  {
    "channel": "discord",
    "target": "123456789012345678",
    "enabled": true
  },
  {
    "channel": "discord",
    "target": "987654321098765432",
    "urgencies": ["high", "critical"],
    "enabled": true
  }
]'
```

## Slash Commands (Optional)

The bot can register slash commands:

| Command | Description |
|---------|-------------|
| `/agentgate list` | List pending requests |
| `/agentgate status <id>` | Check request status |

To enable, add the `applications.commands` scope when inviting.

## Troubleshooting

### Bot offline

- Verify the token is correct
- Check that the bot has been added to the server
- Review logs for connection errors

### Buttons not working

- Ensure the bot has "Read Message History" permission
- Verify the AgentGate server is accessible
- Check for interaction timeout (Discord has a 3-second limit)

### Wrong channel

- Double-check the channel ID (not the name)
- Ensure the bot has access to the channel
