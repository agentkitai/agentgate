# Getting Started

AgentGate provides a standardized way for AI agents to request and receive approvals for sensitive actions. It bridges the gap between autonomous AI capabilities and human oversight.

## Prerequisites

- Node.js 20 or later
- pnpm (recommended) or npm

## Installation

### Option 1: Docker (Recommended)

The fastest way to get started is using Docker:

```bash
# Clone the repository
git clone https://github.com/your-org/agentgate.git
cd agentgate

# Copy environment file
cp .env.example .env

# Generate admin API key
echo "ADMIN_API_KEY=$(openssl rand -hex 32)" >> .env

# Start all services
docker-compose up -d
```

See the [Docker deployment guide](/docker) for more details.

### Option 2: From Source

```bash
# Clone the repository
git clone https://github.com/your-org/agentgate.git
cd agentgate

# Install dependencies
pnpm install

# Run database migrations
pnpm --filter @agentgate/server db:migrate

# Bootstrap (create admin API key)
pnpm --filter @agentgate/server bootstrap
```

::: tip Save Your API Key
The bootstrap command displays your API key only once. Save it immediately:
```bash
export AGENTGATE_API_KEY="agk_..."
```
:::

## Running the Server

Start the development environment:

```bash
# Start server (port 3000) and dashboard (port 5173)
pnpm dev
```

Access the services:
- **API Server**: http://localhost:3000
- **Dashboard**: http://localhost:5173
- **Health Check**: http://localhost:3000/health

## Your First Approval Request

### Using the CLI

```bash
# Install and configure CLI
pnpm --filter @agentgate/cli build
export AGENTGATE_URL=http://localhost:3000
export AGENTGATE_API_KEY=agk_...

# Create a request
agentgate request send_email \
  --params '{"to": "user@example.com", "subject": "Hello"}' \
  --urgency normal

# View pending requests
agentgate list --status pending
```

### Using the SDK

```typescript
import { AgentGateClient } from '@agentgate/sdk'

const client = new AgentGateClient({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.AGENTGATE_API_KEY,
})

const request = await client.request({
  action: 'send_email',
  params: {
    to: 'customer@example.com',
    subject: 'Order shipped!',
  },
  urgency: 'normal',
})

console.log(`Request created: ${request.id}`)
```

### Using the Dashboard

1. Open http://localhost:5173
2. View pending requests in the dashboard
3. Click **Approve** or **Deny** to make a decision

## Run the Demo

In a new terminal (with API key set):

```bash
export AGENTGATE_API_KEY="agk_..."
pnpm demo
```

The demo creates sample approval requests that you can approve or deny in the dashboard.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         AI Agents                                │
│  (use @agentgate/sdk or MCP to request approvals)               │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP API (authenticated)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AgentGate Server                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Policy Engine│  │ Request Store│  │ Audit Logger │          │
│  ├──────────────┤  ├──────────────┤  ├──────────────┤          │
│  │  API Keys    │  │  Webhooks    │  │  MCP Server  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└───────────────────────────┬─────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
┌──────────────────────┐     ┌──────────────────────┐
│    Web Dashboard     │     │  Slack / Discord     │
│  (React + Tailwind)  │     │  (approve in chat)   │
└──────────────────────┘     └──────────────────────┘
              │                           │
              └───────────┬───────────────┘
                          ▼
                    ┌──────────┐
                    │  Humans  │
                    └──────────┘
```

## Next Steps

- [Configure environment variables](/configuration)
- [Deploy with Docker](/docker)
- [Integrate the SDK](/sdk)
- [Set up Slack notifications](/integrations/slack)
