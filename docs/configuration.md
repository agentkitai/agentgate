# Configuration

AgentGate is configured entirely through environment variables. This page documents all available options.

## Environment Variables

### Server

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PORT` | number | `3000` | HTTP server port |
| `HOST` | string | `0.0.0.0` | HTTP server host |
| `NODE_ENV` | enum | `development` | Environment: `development`, `production`, `test` |

### Database

AgentGate supports both SQLite (default) and PostgreSQL.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DB_DIALECT` | enum | `sqlite` | Database dialect: `sqlite` or `postgres` |
| `DATABASE_URL` | string | `./data/agentgate.db` | Database connection URL |

#### SQLite (Default)

SQLite requires no additional setup:

```bash
# File-based (default)
DATABASE_URL=./data/agentgate.db

# In-memory (for testing)
DATABASE_URL=:memory:
```

#### PostgreSQL

For production deployments:

```bash
DB_DIALECT=postgres
DATABASE_URL=postgresql://user:password@localhost:5432/agentgate
```

With SSL:
```bash
DATABASE_URL=postgresql://user:pass@db.example.com:5432/agentgate?sslmode=require
```

### Security

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `ADMIN_API_KEY` | string | - | Admin API key (min 16 chars, **required** in production) |
| `JWT_SECRET` | string | - | JWT signing secret (min 32 chars, recommended in production) |
| `CORS_ALLOWED_ORIGINS` | string | `*` | Allowed CORS origins (comma-separated) |
| `HSTS_ENABLED` | boolean | `false` | Enable HTTP Strict Transport Security header |
| `WEBHOOK_ENCRYPTION_KEY` | string | - | AES-256-GCM key for encrypting webhook secrets at rest |
| `BODY_SIZE_LIMIT` | string | `100kb` | Maximum request body size (e.g., `100kb`, `1mb`) |

::: danger Production Requirements
In production (`NODE_ENV=production`), `ADMIN_API_KEY` is required and must be at least 16 characters.
:::

### Rate Limiting

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `RATE_LIMIT_ENABLED` | boolean | `true` | Enable rate limiting |
| `RATE_LIMIT_RPM` | number | `60` | Requests per minute per API key |

### Request Handling

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `REQUEST_TIMEOUT_SEC` | number | `3600` | Default request timeout (1 hour) |
| `WEBHOOK_TIMEOUT_MS` | number | `5000` | Webhook delivery timeout |
| `WEBHOOK_MAX_RETRIES` | number | `3` | Maximum webhook retry attempts |

### Cleanup

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CLEANUP_RETENTION_DAYS` | number | `30` | Retention period in days for expired tokens and webhook deliveries |
| `CLEANUP_INTERVAL_MS` | number | `3600000` | How often the cleanup job runs (in milliseconds, default: 1 hour) |

### API Key Cache

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `API_KEY_CACHE_TTL_SEC` | number | `60` | TTL in seconds for cached API key lookups |
| `API_KEY_CACHE_MAX_SIZE` | number | `1000` | Maximum number of API keys held in the in-memory cache |

### Logging

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `LOG_LEVEL` | enum | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `LOG_FORMAT` | enum | `pretty` | Log format: `json`, `pretty` |

## Integration Configuration

### Slack

| Variable | Type | Description |
|----------|------|-------------|
| `SLACK_BOT_TOKEN` | string | Slack bot OAuth token (xoxb-...) |
| `SLACK_SIGNING_SECRET` | string | Slack app signing secret |
| `SLACK_DEFAULT_CHANNEL` | string | Default channel for notifications |

See [Slack Integration](/integrations/slack) for setup details.

### Discord

| Variable | Type | Description |
|----------|------|-------------|
| `DISCORD_BOT_TOKEN` | string | Discord bot token |
| `DISCORD_DEFAULT_CHANNEL` | string | Default channel ID |

See [Discord Integration](/integrations/discord) for setup details.

### Email (SMTP)

| Variable | Type | Description |
|----------|------|-------------|
| `SMTP_HOST` | string | SMTP server hostname |
| `SMTP_PORT` | number | SMTP server port |
| `SMTP_USER` | string | SMTP username |
| `SMTP_PASS` | string | SMTP password |
| `SMTP_FROM` | string | Sender email address |

See [Email Integration](/integrations/email) for setup details.

## Channel Routing

Route notifications to different channels based on action type or urgency.

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
  }
]'
```

### Route Schema

```typescript
interface ChannelRoute {
  channel: "slack" | "discord" | "email" | "webhook" | "sms"
  target: string           // Channel ID, email, or webhook URL
  actions?: string[]       // Filter by action types
  urgencies?: ("low" | "normal" | "high" | "critical")[]
  enabled?: boolean        // Default: true
}
```

## Example .env File

```bash
# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# Database
DB_DIALECT=postgres
DATABASE_URL=postgresql://user:password@localhost:5432/agentgate

# Security
ADMIN_API_KEY=your-secure-admin-key-at-least-16-chars
JWT_SECRET=your-secure-jwt-secret-at-least-32-characters
CORS_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com

# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_RPM=100

# Timeouts
REQUEST_TIMEOUT_SEC=3600
WEBHOOK_TIMEOUT_MS=5000

# Slack
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_DEFAULT_CHANNEL=#agentgate-alerts

# Security (additional)
HSTS_ENABLED=true
WEBHOOK_ENCRYPTION_KEY=your-32-byte-hex-key
BODY_SIZE_LIMIT=100kb

# Cleanup
CLEANUP_RETENTION_DAYS=30
CLEANUP_INTERVAL_MS=3600000

# API Key Cache
API_KEY_CACHE_TTL_SEC=60
API_KEY_CACHE_MAX_SIZE=1000

# Logging
LOG_LEVEL=info
LOG_FORMAT=json
```

## Production Checklist

When running in production, ensure:

- [ ] `ADMIN_API_KEY` is set (min 16 characters)
- [ ] `JWT_SECRET` is set (min 32 characters)
- [ ] `CORS_ALLOWED_ORIGINS` is restricted (not `*`)
- [ ] `DATABASE_URL` points to a persistent location
- [ ] `LOG_FORMAT=json` for structured logging
- [ ] `WEBHOOK_ENCRYPTION_KEY` is set for webhook secret encryption
- [ ] `HSTS_ENABLED=true` if behind TLS
- [ ] Rate limiting is enabled

The server logs warnings at startup if these aren't configured.

## Database Migrations

```bash
# Apply migrations (auto-detects dialect)
pnpm db:migrate

# Or specify dialect
pnpm db:migrate:sqlite
pnpm db:migrate:postgres

# Generate new migrations
pnpm db:generate
```
