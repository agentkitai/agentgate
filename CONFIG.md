# AgentGate Configuration

This document describes all configuration options for AgentGate.

## Environment Variables

All configuration is done via environment variables. The server validates these at startup.

### Server

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PORT` | number | `3000` | HTTP server port |
| `HOST` | string | `0.0.0.0` | HTTP server host |
| `NODE_ENV` | enum | `development` | Environment: `development`, `production`, `test` |

### Database

AgentGate supports both SQLite (default) and PostgreSQL databases.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DB_DIALECT` | enum | `sqlite` | Database dialect: `sqlite` or `postgres` |
| `DATABASE_URL` | string | `./data/agentgate.db` | Database URL (see below for format) |

#### SQLite (Default)

SQLite is the default and requires no additional setup. The `DATABASE_URL` is a file path:

```bash
# File-based database (default)
DATABASE_URL=./data/agentgate.db

# In-memory database (for testing)
DATABASE_URL=:memory:
```

#### PostgreSQL

For production deployments, PostgreSQL is recommended:

```bash
DB_DIALECT=postgres
DATABASE_URL=postgresql://user:password@localhost:5432/agentgate
```

**PostgreSQL Setup:**

1. Create a database:
   ```sql
   CREATE DATABASE agentgate;
   ```

2. Set environment variables:
   ```bash
   export DB_DIALECT=postgres
   export DATABASE_URL=postgresql://user:password@localhost:5432/agentgate
   ```

3. Run migrations:
   ```bash
   pnpm db:migrate:postgres
   ```

**Connection String Format:**
```
postgresql://[user]:[password]@[host]:[port]/[database]?[options]
```

Options:
- `sslmode=require` - Require SSL connection
- `connect_timeout=10` - Connection timeout in seconds

Example with SSL:
```bash
DATABASE_URL=postgresql://user:pass@db.example.com:5432/agentgate?sslmode=require
```

### Security

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `ADMIN_API_KEY` | string | - | Admin API key (min 16 chars, required in production) |
| `JWT_SECRET` | string | - | JWT signing secret (min 32 chars, recommended in production) |
| `CORS_ORIGINS` | string | `*` | Allowed CORS origins (comma-separated) |

### Rate Limiting

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `RATE_LIMIT_ENABLED` | boolean | `true` | Enable rate limiting |
| `RATE_LIMIT_RPM` | number | `60` | Requests per minute per API key |

### Request Handling

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `REQUEST_TIMEOUT_SEC` | number | `3600` | Default request timeout in seconds |
| `WEBHOOK_TIMEOUT_MS` | number | `5000` | Webhook delivery timeout in milliseconds |
| `WEBHOOK_MAX_RETRIES` | number | `3` | Maximum webhook retry attempts |

### Slack Integration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SLACK_BOT_TOKEN` | string | - | Slack bot OAuth token (xoxb-...) |
| `SLACK_SIGNING_SECRET` | string | - | Slack app signing secret |
| `SLACK_DEFAULT_CHANNEL` | string | - | Default Slack channel for notifications |

### Discord Integration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DISCORD_BOT_TOKEN` | string | - | Discord bot token |
| `DISCORD_DEFAULT_CHANNEL` | string | - | Default Discord channel ID |

### Email Integration (SMTP)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SMTP_HOST` | string | - | SMTP server hostname |
| `SMTP_PORT` | number | `587` | SMTP server port (use 465 for SSL) |
| `SMTP_USER` | string | - | SMTP username |
| `SMTP_PASS` | string | - | SMTP password |
| `SMTP_FROM` | string | - | Sender email address |
| `DASHBOARD_URL` | string | - | Dashboard URL for "View in Dashboard" links in emails |

**Email notifications include:**
- One-click approve/deny buttons using secure decision tokens
- Request details (action, parameters, urgency)
- Link to view request in dashboard (if `DASHBOARD_URL` is configured)
- HTML and plain-text versions for compatibility

### Logging

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `LOG_LEVEL` | enum | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `LOG_FORMAT` | enum | `pretty` | Log format: `json`, `pretty` |

### Channel Routing

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CHANNEL_ROUTES` | JSON | `[]` | JSON array of channel routing rules |

## Channel Routing Format

The `CHANNEL_ROUTES` environment variable accepts a JSON array of routing rules. Each rule specifies which events should be sent to which notification channel.

### Route Schema

```typescript
interface ChannelRoute {
  // Channel type: "slack" | "discord" | "email" | "webhook" | "sms"
  channel: string;
  
  // Target identifier (channel ID, email address, webhook URL, etc.)
  target: string;
  
  // Optional: only route events for these actions
  actions?: string[];
  
  // Optional: only route events with these urgency levels
  urgencies?: ("low" | "normal" | "high" | "critical")[];
  
  // Whether this route is enabled (default: true)
  enabled?: boolean;
}
```

### Example Configuration

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
    "channel": "email",
    "target": "security@company.com",
    "actions": ["transfer_funds", "delete_account"],
    "urgencies": ["high", "critical"],
    "enabled": true
  },
  {
    "channel": "webhook",
    "target": "https://ops.example.com/webhooks/agentgate",
    "enabled": true
  }
]'
```

### Supported Channels

| Channel | Target Format | Description |
|---------|---------------|-------------|
| `slack` | Channel name or ID | e.g., `#general` or `C1234567890` |
| `discord` | Channel ID | e.g., `123456789012345678` |
| `email` | Email address | e.g., `alerts@company.com` |
| `webhook` | URL | e.g., `https://example.com/webhook` |
| `sms` | Phone number | e.g., `+1234567890` |

## Event Types

AgentGate emits the following events that can trigger notifications:

### Request Lifecycle Events

| Event | Description |
|-------|-------------|
| `request.created` | New approval request created |
| `request.updated` | Request metadata updated |
| `request.decided` | Request approved or denied |
| `request.expired` | Request timed out without decision |
| `request.escalated` | Request escalated to different approver |

### Policy Events

| Event | Description |
|-------|-------------|
| `policy.created` | New policy created |
| `policy.updated` | Policy rules updated |
| `policy.deleted` | Policy removed |
| `policy.matched` | Policy matched an incoming request |

### Webhook Events

| Event | Description |
|-------|-------------|
| `webhook.triggered` | Webhook delivery attempted |
| `webhook.failed` | Webhook delivery failed |
| `webhook.retry` | Webhook being retried |

### API Key Events

| Event | Description |
|-------|-------------|
| `api_key.created` | New API key created |
| `api_key.revoked` | API key revoked |
| `api_key.rate_limited` | API key hit rate limit |

### System Events

| Event | Description |
|-------|-------------|
| `system.startup` | Server started |
| `system.shutdown` | Server shutting down |
| `system.error` | System error occurred |

## Database Migrations

AgentGate uses Drizzle ORM for database migrations. Migrations are stored separately for each dialect.

### Migration Commands

```bash
# Generate migrations (detects dialect from DB_DIALECT)
pnpm db:generate

# Generate migrations for specific dialect
pnpm db:generate:sqlite
pnpm db:generate:postgres

# Apply migrations (detects dialect from DB_DIALECT)
pnpm db:migrate

# Apply migrations for specific dialect
pnpm db:migrate:sqlite
pnpm db:migrate:postgres

# Open Drizzle Studio (database browser)
pnpm db:studio
pnpm db:studio:sqlite
pnpm db:studio:postgres
```

### Migration Files

Migrations are stored in:
- SQLite: `packages/server/drizzle/sqlite/`
- PostgreSQL: `packages/server/drizzle/postgres/`

Both dialects maintain separate migration histories. When switching dialects, ensure you run the appropriate migrations for that dialect.

## Example .env File

```bash
# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# Database (SQLite)
DB_DIALECT=sqlite
DATABASE_URL=/var/data/agentgate.db

# Database (PostgreSQL - alternative)
# DB_DIALECT=postgres
# DATABASE_URL=postgresql://user:password@localhost:5432/agentgate

# Security
ADMIN_API_KEY=your-secure-admin-key-here
JWT_SECRET=your-secure-jwt-secret-at-least-32-characters
CORS_ORIGINS=https://app.example.com,https://admin.example.com

# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_RPM=100

# Timeouts
REQUEST_TIMEOUT_SEC=3600
WEBHOOK_TIMEOUT_MS=5000
WEBHOOK_MAX_RETRIES=3

# Slack
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_DEFAULT_CHANNEL=#agentgate-alerts

# Logging
LOG_LEVEL=info
LOG_FORMAT=json

# Channel Routing (see above for full format)
CHANNEL_ROUTES='[{"channel":"slack","target":"#alerts","enabled":true}]'
```

## Production Checklist

When running in production (`NODE_ENV=production`), ensure:

- [ ] `ADMIN_API_KEY` is set (minimum 16 characters)
- [ ] `JWT_SECRET` is set (minimum 32 characters)
- [ ] `CORS_ORIGINS` is restricted (not `*`)
- [ ] `DATABASE_URL` points to a persistent location
- [ ] `LOG_FORMAT=json` for structured logging
- [ ] Rate limiting is enabled

The server will log warnings at startup if these are not configured correctly.

## Programmatic Access

Configuration can be accessed programmatically in the server:

```typescript
import { getConfig, loadConfigSafe, validateProductionConfig } from './config.js';

// Get cached config (lazy-loaded)
const config = getConfig();
console.log(`Server running on port ${config.port}`);

// Safe loading with error handling
const { config, errors } = loadConfigSafe();
if (errors.length > 0) {
  console.error('Config errors:', errors);
  process.exit(1);
}

// Validate production requirements
const warnings = validateProductionConfig(config);
warnings.forEach(w => console.warn(w));
```
