# @agentgate/slack

Slack bot integration for AgentGate human approvals.

## Features

- 🔔 Sends formatted approval request messages with Block Kit
- ✅ Interactive Approve/Deny buttons
- 🔄 Updates messages after decision
- 📦 Can be used as a library or standalone service

## Installation

```bash
pnpm add @agentgate/slack
```

## Slack App Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name it (e.g., "AgentGate Approvals") and select your workspace

### 2. Configure Bot Scopes

Navigate to **OAuth & Permissions** and add these Bot Token Scopes:

- `chat:write` - Send messages
- `chat:write.public` - Send to channels the bot isn't a member of
- `commands` - (Optional) For future slash commands

### 3. Enable Interactivity

Navigate to **Interactivity & Shortcuts**:

1. Toggle **Interactivity** to **On**
2. Set **Request URL** to your bot's URL:
   - For local development with ngrok: `https://your-ngrok-url.ngrok.io/slack/events`
   - For production: `https://your-server.com/slack/events`

### 4. Install to Workspace

1. Go to **Install App** in the sidebar
2. Click **Install to Workspace**
3. Authorize the requested permissions

### 5. Get Credentials

After installation, you'll need:

- **Bot Token** (`xoxb-...`) - Found in **OAuth & Permissions**
- **Signing Secret** - Found in **Basic Information** → **App Credentials**

## Usage

### As a Library

```typescript
import { createSlackBot } from '@agentgate/slack';

const bot = createSlackBot({
  token: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  agentgateUrl: 'http://localhost:3000',
  defaultChannel: '#approvals',
  port: 3001,
});

await bot.start();

// Send an approval request
await bot.sendApprovalRequest(request, '#approvals');
```

### Standalone Service

Set environment variables and run:

```bash
# Required
export SLACK_BOT_TOKEN=xoxb-your-token
export SLACK_SIGNING_SECRET=your-signing-secret

# Optional
export AGENTGATE_URL=http://localhost:3000  # default
export AGENTGATE_API_KEY=your-api-key       # recommended for authenticated API calls
export SLACK_BOT_PORT=3001                  # default
export SLACK_DEFAULT_CHANNEL=#approvals

# Run
pnpm start
```

Or with a `.env` file:

```env
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_SIGNING_SECRET=your-signing-secret
AGENTGATE_URL=http://localhost:3000
AGENTGATE_API_KEY=your-api-key
SLACK_BOT_PORT=3001
SLACK_DEFAULT_CHANNEL=#approvals
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SLACK_BOT_TOKEN` | Yes | - | Slack bot token (xoxb-...) |
| `SLACK_SIGNING_SECRET` | Yes | - | Slack app signing secret |
| `AGENTGATE_URL` | No | `http://localhost:3000` | AgentGate server URL |
| `AGENTGATE_API_KEY` | Recommended | - | API key for AgentGate API authentication |
| `SLACK_BOT_PORT` | No | `3001` | Port for the bot to listen on |
| `SLACK_DEFAULT_CHANNEL` | No | - | Default channel for notifications |

## Message Format

Approval requests are formatted using Slack Block Kit:

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
[🔗 Approve (one-click)] [🔗 Deny (one-click)]
⏰ One-click links expire: 2024-01-16T10:30:00Z
```

The message includes two types of buttons:
- **Interactive buttons**: Work with the Slack bot to approve/deny via the API
- **One-click link buttons**: Open in browser for direct approval/denial (useful for mobile or when bot is unavailable)

After a decision, the message updates to show:

```
✅ Request Approved
━━━━━━━━━━━━━━━━━━━━
Action: send_email
Decision: Approved by @username
```

## API Integration

The bot communicates with AgentGate server via:

```
POST /api/requests/:id/decide
{
  "decision": "approved" | "denied",
  "decidedBy": "slack_user_id"
}
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

## License

MIT
