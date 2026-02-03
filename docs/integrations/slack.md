# Slack Integration

The `@agentgate/slack` package provides a Slack bot for sending approval requests and receiving decisions directly in Slack.

## Features

- 🔔 Sends formatted approval requests with Block Kit
- ✅ Interactive Approve/Deny buttons
- 🔄 Updates messages after decision
- 📦 Can be used as a library or standalone service

## Slack App Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name it (e.g., "AgentGate Approvals") and select your workspace

### 2. Configure Bot Scopes

Navigate to **OAuth & Permissions** and add these Bot Token Scopes:

- `chat:write` — Send messages
- `chat:write.public` — Send to channels the bot isn't a member of

### 3. Enable Interactivity

Navigate to **Interactivity & Shortcuts**:

1. Toggle **Interactivity** to **On**
2. Set **Request URL** to:
   - Local (with ngrok): `https://your-ngrok-url.ngrok.io/slack/events`
   - Production: `https://your-server.com/slack/events`

### 4. Install to Workspace

1. Go to **Install App** in the sidebar
2. Click **Install to Workspace**
3. Authorize the requested permissions

### 5. Get Credentials

After installation, copy:

- **Bot Token** (`xoxb-...`) — Found in **OAuth & Permissions**
- **Signing Secret** — Found in **Basic Information** → **App Credentials**

## Configuration

Set the environment variables:

```bash
# Required
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_SIGNING_SECRET=your-signing-secret

# Optional
AGENTGATE_URL=http://localhost:3000  # default
SLACK_BOT_PORT=3001                  # default
SLACK_DEFAULT_CHANNEL=#approvals
```

## Running the Bot

### With Docker

The Slack bot is included in the docker-compose setup:

```bash
# Set credentials in .env
docker-compose --profile bots up -d
```

### Standalone

```bash
# Install
npm install @agentgate/slack

# Run
SLACK_BOT_TOKEN=xoxb-... \
SLACK_SIGNING_SECRET=... \
AGENTGATE_URL=http://localhost:3000 \
npx @agentgate/slack
```

### As a Library

```typescript
import { createSlackBot } from '@agentgate/slack'

const bot = createSlackBot({
  token: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  agentgateUrl: 'http://localhost:3000',
  defaultChannel: '#approvals',
  port: 3001,
})

await bot.start()
console.log('Slack bot running on port 3001')

// Send a request manually
await bot.sendApprovalRequest(request, '#specific-channel')
```

## Message Format

Approval requests are formatted with Slack Block Kit:

```
🔔 Approval Request
━━━━━━━━━━━━━━━━━━━━
Action: send_email
Urgency: 🟡 normal
Request ID: req_123abc
Created: 2024-01-15T10:30:00Z

Parameters:
{
  "to": "user@example.com",
  "subject": "Hello"
}

📋 Context: {"agent": "email-agent"}
━━━━━━━━━━━━━━━━━━━━
[✅ Approve] [❌ Deny]
```

After a decision:

```
✅ Request Approved
━━━━━━━━━━━━━━━━━━━━
Action: send_email
Decision: Approved by @username
```

## Channel Routing

Route requests to different channels based on urgency or action:

```bash
export CHANNEL_ROUTES='[
  {
    "channel": "slack",
    "target": "#general-alerts",
    "enabled": true
  },
  {
    "channel": "slack",
    "target": "#critical-alerts",
    "urgencies": ["critical"],
    "enabled": true
  },
  {
    "channel": "slack",
    "target": "#security-team",
    "actions": ["delete_account", "export_data"],
    "enabled": true
  }
]'
```

## Local Development

For local development, use [ngrok](https://ngrok.com/) to expose your bot:

```bash
# Terminal 1: Start the bot
pnpm dev

# Terminal 2: Expose with ngrok
ngrok http 3001
```

Then update your Slack app's Request URL with the ngrok URL.

## Troubleshooting

### Bot not responding to button clicks

- Verify the Request URL is correct in Slack app settings
- Check that the signing secret matches
- Ensure the bot has network access to the AgentGate server

### Messages not appearing

- Verify the bot is in the channel or has `chat:write.public` scope
- Check the channel name format (`#channel` or channel ID)
- Review bot logs for errors
