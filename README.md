# AgentGate

**Human-in-the-loop approval system for AI agents.**

AgentGate provides a standardized way for AI agents to request and receive approvals for sensitive actions. It bridges the gap between autonomous AI capabilities and human oversight.

## Features

- 🛡️ **Policy Engine** — Auto-approve, auto-deny, or route to humans based on configurable rules
- 👥 **Human Approvals** — Via Slack bot or web dashboard
- 📊 **Real-time Dashboard** — Monitor and manage approval requests
- 📝 **Audit Logging** — Complete history of all requests and decisions
- 🔌 **TypeScript SDK** — Easy integration for agents
- 🔐 **API Key Authentication** — Secure access with scoped API keys
- 🪝 **Webhooks** — Real-time notifications for request events
- 🤖 **MCP Integration** — Use with Claude Desktop via Model Context Protocol
- ⚡ **Fast & Lightweight** — Hono server with SQLite storage

## Quick Start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Run database migrations

```bash
pnpm --filter @agentgate/server db:migrate
```

### 3. Bootstrap (create admin API key)

```bash
pnpm --filter @agentgate/server bootstrap
```

**Save the API key** - it's shown once only! Set it in your environment:

```bash
export AGENTGATE_API_KEY="agk_..."
```

### 4. Start the development environment

```bash
# Start server (port 3000) and dashboard (port 5173)
pnpm dev
```

### 5. Run the demo

In a new terminal (with API key set):

```bash
export AGENTGATE_API_KEY="agk_..."
pnpm demo
```

### 6. Open the dashboard

Visit **http://localhost:5173** to view and manage approval requests.

## Authentication

AgentGate uses API keys for authentication. All API requests (except `/health`) require a valid API key.

### API Key Scopes

| Scope | Description |
|-------|-------------|
| `admin` | Full access to all operations |
| `request:create` | Create new approval requests |
| `request:read` | Read approval requests |
| `request:decide` | Approve or deny requests |
| `webhook:manage` | Create/update/delete webhooks |

### Using API Keys

**HTTP Header:**
```bash
curl -H "Authorization: Bearer agk_..." http://localhost:3000/api/requests
```

**SDK:**
```typescript
const client = new AgentGateClient({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.AGENTGATE_API_KEY,
});
```

### Creating Additional API Keys

```typescript
// Via API (requires admin scope)
POST /api/keys
{
  "name": "My Agent",
  "scopes": ["request:create", "request:read"]
}
```

## MCP Integration

AgentGate includes a Model Context Protocol (MCP) server for integration with Claude Desktop and other MCP-compatible clients.

### Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentgate": {
      "command": "npx",
      "args": ["@agentgate/mcp"],
      "env": {
        "AGENTGATE_URL": "http://localhost:3000",
        "AGENTGATE_API_KEY": "agk_..."
      }
    }
  }
}
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `request_approval` | Create a new approval request |
| `check_request` | Get status of an approval request |
| `list_requests` | List pending approval requests |

## CLI

AgentGate includes a command-line interface for managing approval requests.

### Installation

```bash
# From the monorepo
pnpm --filter @agentgate/cli build

# Or install globally (when published)
npm install -g @agentgate/cli
```

### Configuration

Configure the CLI with your server URL and API key:

```bash
# Set server URL
agentgate config set serverUrl http://localhost:3000

# Set API key
agentgate config set apiKey agk_your_api_key

# View current config
agentgate config show
```

Configuration is stored in `~/.agentgate/config.json`. You can also use environment variables:

```bash
export AGENTGATE_URL=http://localhost:3000
export AGENTGATE_API_KEY=agk_...
```

### Commands

| Command | Description |
|---------|-------------|
| `agentgate config show` | Show current configuration |
| `agentgate config set <key> <value>` | Set a configuration value |
| `agentgate request <action>` | Create a new approval request |
| `agentgate status <id>` | Get status of a request |
| `agentgate list` | List approval requests |
| `agentgate approve <id>` | Approve a pending request |
| `agentgate deny <id>` | Deny a pending request |

### Examples

```bash
# Create a request
agentgate request send_email \
  --params '{"to": "user@example.com", "subject": "Hello"}' \
  --urgency high

# List pending requests
agentgate list --status pending

# Approve a request
agentgate approve req_abc123 --reason "Looks good"

# Deny a request
agentgate deny req_abc123 --reason "Not authorized"

# Output as JSON
agentgate list --json
```

## Rate Limiting

AgentGate supports per-API-key rate limiting to prevent abuse and ensure fair usage.

### How It Works

- Rate limits use a **sliding window algorithm** (requests per minute)
- Limits are configured per API key
- When exceeded, requests return `429 Too Many Requests`
- Rate limit headers are included in all authenticated responses

### Rate Limit Headers

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests per minute |
| `X-RateLimit-Remaining` | Remaining requests in current window |
| `X-RateLimit-Reset` | Seconds until window resets |

### Configuring Rate Limits

Set rate limits when creating or updating API keys:

```typescript
// Via API (requires admin scope)
POST /api/keys
{
  "name": "My Agent",
  "scopes": ["request:create", "request:read"],
  "rateLimit": 60  // 60 requests per minute
}

// null = unlimited
{
  "name": "Internal Service",
  "scopes": ["admin"],
  "rateLimit": null
}
```

### Dashboard

Rate limits can also be managed from the web dashboard under **Settings → API Keys**.

## Webhooks

AgentGate can notify external systems when request events occur.

### Setting Up Webhooks

```typescript
// Create a webhook via API
POST /api/webhooks
{
  "url": "https://your-server.com/webhook",
  "events": ["request.created", "request.decided"],
  "secret": "optional-signing-secret"
}
```

### Webhook Events

| Event | Description |
|-------|-------------|
| `request.created` | A new approval request was created |
| `request.decided` | A request was approved or denied |
| `request.expired` | A request expired without decision |

### Webhook Payload

```json
{
  "event": "request.decided",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "id": "abc123",
    "action": "send_email",
    "status": "approved",
    "decidedBy": "admin@example.com"
  }
}
```

### Webhook Signatures

If you provide a `secret`, requests are signed with HMAC-SHA256:

```
X-AgentGate-Signature: sha256=...
```

Verify by computing `HMAC-SHA256(secret, body)` and comparing.

## Architecture

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
│    Web Dashboard     │     │     Slack Bot        │
│  (React + Tailwind)  │     │  (approve in Slack)  │
└──────────────────────┘     └──────────────────────┘
              │                           │
              └───────────┬───────────────┘
                          ▼
                    ┌──────────┐
                    │  Humans  │
                    └──────────┘
```

## Packages

| Package | Description | Docs |
|---------|-------------|------|
| [`@agentgate/core`](./packages/core) | Types, schemas, policy engine | - |
| [`@agentgate/server`](./packages/server) | Hono API server | - |
| [`@agentgate/sdk`](./packages/sdk) | TypeScript SDK for agents | [README](./packages/sdk/README.md) |
| [`@agentgate/cli`](./packages/cli) | Command-line interface | - |
| [`@agentgate/mcp`](./packages/mcp) | MCP server for Claude Desktop | - |
| [`@agentgate/slack`](./packages/slack) | Slack bot integration | [README](./packages/slack/README.md) |
| [`@agentgate/dashboard`](./packages/dashboard) | React web dashboard | - |

## SDK Usage

```typescript
import { AgentGateClient } from '@agentgate/sdk';

// Create client with API key
const client = new AgentGateClient({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.AGENTGATE_API_KEY,
});

// Request approval
const request = await client.request({
  action: 'send_email',
  params: {
    to: 'customer@example.com',
    subject: 'Order shipped!',
  },
  urgency: 'normal',
});

// Wait for human decision
const decided = await client.waitForDecision(request.id, {
  timeout: 60000, // 1 minute
});

if (decided.status === 'approved') {
  // Execute the action
  await sendEmail(decided.params);
  
  // Confirm execution (for audit trail)
  await client.confirm(decided.id);
} else {
  console.log('Action denied:', decided.decisionReason);
}
```

## API Endpoints

| Method | Endpoint | Description | Required Scope |
|--------|----------|-------------|----------------|
| `POST` | `/api/requests` | Create approval request | `request:create` |
| `GET` | `/api/requests` | List requests (with filters) | `request:read` |
| `GET` | `/api/requests/:id` | Get request by ID | `request:read` |
| `POST` | `/api/requests/:id/decide` | Submit approval/denial | `request:decide` |
| `POST` | `/api/requests/:id/confirm` | Confirm action execution | `request:create` |
| `GET` | `/api/requests/:id/audit` | Get audit trail | `request:read` |
| `GET` | `/api/policies` | List policies | `admin` |
| `POST` | `/api/policies` | Create policy | `admin` |
| `GET` | `/api/webhooks` | List webhooks | `webhook:manage` |
| `POST` | `/api/webhooks` | Create webhook | `webhook:manage` |
| `DELETE` | `/api/webhooks/:id` | Delete webhook | `webhook:manage` |
| `GET` | `/health` | Health check | (none) |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DATABASE_URL` | `./data/agentgate.db` | SQLite database path |
| `AGENTGATE_API_KEY` | - | API key for SDK/CLI |
| `SLACK_BOT_TOKEN` | - | Slack bot token (for Slack integration) |
| `SLACK_SIGNING_SECRET` | - | Slack signing secret |

### Policy Configuration

Policies are stored in the database and can be managed via API:

```typescript
// Example: Auto-approve low-risk emails
{
  name: "auto-approve-emails",
  priority: 10,
  enabled: true,
  rules: [
    {
      match: { action: "send_email" },
      decision: "auto_approve"
    }
  ]
}
```

## Development

```bash
# Install dependencies
pnpm install

# Run migrations
pnpm --filter @agentgate/server db:migrate

# Bootstrap (create admin key)
pnpm --filter @agentgate/server bootstrap

# Start development (server + dashboard)
pnpm dev
```

### Testing

AgentGate uses [Vitest](https://vitest.dev/) for testing across all packages.

```bash
# Run all tests
pnpm test

# Run tests with coverage report
pnpm test:coverage

# Run tests in watch mode (single package)
pnpm --filter @agentgate/server test:watch

# Run a specific test file
pnpm --filter @agentgate/server test -- src/__tests__/integration.test.ts
```

Coverage reports are generated per-package and include line, branch, and function coverage.

### Code Quality

```bash
# Build all packages
pnpm build

# Type checking
pnpm typecheck

# Lint (ESLint)
pnpm lint

# Fix lint issues
pnpm lint:fix

# Format code (Prettier)
pnpm format

# Check formatting
pnpm format:check
```

## Docker

Start Redis (for future queue/pub-sub features):

```bash
docker-compose up -d
```

## Project Structure

```
agentgate/
├── packages/
│   ├── core/           # Shared types, schemas, policy engine
│   ├── server/         # Hono API server
│   ├── sdk/            # TypeScript SDK
│   ├── cli/            # Command-line interface
│   ├── mcp/            # MCP server for Claude Desktop
│   ├── slack/          # Slack bot
│   └── dashboard/      # React dashboard
├── apps/
│   └── demo/           # Demo application
├── docker-compose.yml  # Redis for queuing
└── package.json        # Monorepo root
```

## License

MIT
