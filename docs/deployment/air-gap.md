# Air-Gap Deployment Guide

This guide covers deploying AgentGate in air-gapped (network-isolated) environments where hosts have no internet access. This is common in defense, government, financial, and healthcare environments with strict security requirements.

## Overview

An air-gap deployment involves three phases:

1. **Build** — Build and bundle all Docker images on an internet-connected machine
2. **Transfer** — Move the image bundle to the air-gapped host via removable media
3. **Deploy** — Load images and start services on the isolated host

```
┌─────────────────────┐          ┌─────────────────────┐
│  Connected Machine  │  ──────► │  Air-Gapped Host    │
│                     │  USB /   │                     │
│  • Build images     │  media   │  • Load images      │
│  • Save bundle      │          │  • Configure .env   │
│  • Export configs    │          │  • docker compose up│
└─────────────────────┘          └─────────────────────┘
```

## Prerequisites

| Requirement | Connected Machine | Air-Gapped Host |
|-------------|-------------------|-----------------|
| Docker Engine | ✅ 20.10+ | ✅ 20.10+ |
| Docker Compose | ✅ v2.x | ✅ v2.x |
| Internet access | ✅ | ❌ |
| Disk space | ~2 GB free | ~2 GB free |

## Phase 1: Build Images (Connected Machine)

### 1.1 Clone and Build

On a machine with internet access, clone the repository and build all images:

```bash
git clone https://github.com/your-org/agentgate.git
cd agentgate

# Build all service images
docker compose build
```

This builds the following images:

| Image | Description |
|-------|-------------|
| `agentgate-server` | AgentGate API server (Node.js) |
| `agentgate-dashboard` | Web dashboard (nginx) |

It also pulls these base images:

| Image | Description |
|-------|-------------|
| `postgres:16-alpine` | PostgreSQL database |
| `redis:7-alpine` | Redis (rate limiting, queues) |

### 1.2 Save the Image Bundle

Export all required images into a single compressed archive:

```bash
docker save \
  agentgate-server \
  agentgate-dashboard \
  postgres:16-alpine \
  redis:7-alpine \
  | gzip > agentgate-bundle.tar.gz
```

::: tip Bundle Size
The compressed bundle is typically **500 MB – 1 GB** depending on image layers. Ensure your transfer media has sufficient space.
:::

::: info Including the Slack Bot
If you plan to use the Slack bot service (unlikely in air-gapped environments), include its image as well:

```bash
docker compose build slack-bot

docker save \
  agentgate-server \
  agentgate-dashboard \
  agentgate-slack-bot \
  postgres:16-alpine \
  redis:7-alpine \
  | gzip > agentgate-bundle.tar.gz
```
:::

### 1.3 Prepare Configuration Files

Copy these files alongside the bundle for transfer:

```bash
# Create a transfer directory
mkdir -p agentgate-transfer
cp agentgate-bundle.tar.gz agentgate-transfer/
cp .env.example agentgate-transfer/
cp docker-compose.yml agentgate-transfer/
cp docker-compose.production.yml agentgate-transfer/
```

## Phase 2: Transfer to Air-Gapped Host

Transfer the `agentgate-transfer/` directory to the air-gapped host using your organization's approved media transfer process:

- **USB drive** — Most common for small bundles
- **Optical media** (DVD/Blu-ray) — For write-once audit requirements
- **Data diode** — For one-way network transfers
- **Cross-domain solution** — For environments with CDS infrastructure

::: warning Security Scanning
Follow your organization's media scanning and sanitization policies before connecting removable media to the air-gapped network.
:::

## Phase 3: Deploy on Air-Gapped Host

### 3.1 Load Docker Images

On the air-gapped host, load the image bundle:

```bash
docker load < agentgate-bundle.tar.gz
```

Verify all images are available:

```bash
docker images | grep -E "agentgate|postgres|redis"
```

Expected output:

```
agentgate-server       latest    abc123def456   ...   350MB
agentgate-dashboard    latest    789ghi012jkl   ...   25MB
postgres               16-alpine 345mno678pqr   ...   240MB
redis                  7-alpine  901stu234vwx   ...   30MB
```

### 3.2 Configure Environment

Create your `.env` file from the example:

```bash
cp .env.example .env
```

Generate credentials **locally** (no internet required):

```bash
# Generate admin API key
echo "ADMIN_API_KEY=$(openssl rand -hex 32)" >> .env

# Generate JWT secret
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env

# Generate webhook encryption key (encrypts webhook secrets at rest)
echo "WEBHOOK_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env
```

#### Air-Gap-Specific Configuration

The following settings are critical for air-gapped environments:

```bash
# .env - Air-gap specific settings

# ── Decision Links ──────────────────────────────────────────────
# DECISION_LINK_BASE_URL controls the base URL embedded in
# notification messages (email, Slack, webhook payloads) that link
# to the approval/deny actions.
#
# In air-gapped environments, this MUST point to an internal
# hostname or IP reachable by users on the isolated network.
#
# Default: http://localhost:3000
DECISION_LINK_BASE_URL=https://agentgate.internal.corp:3000

# ── Dashboard URL ───────────────────────────────────────────────
# Used for "View in Dashboard" links in notifications.
# Must also be an internal hostname.
DASHBOARD_URL=https://agentgate.internal.corp:8080

# ── CORS Origins ────────────────────────────────────────────────
# Restrict to your internal hostname(s)
CORS_ALLOWED_ORIGINS=https://agentgate.internal.corp:8080

# ── Logging ─────────────────────────────────────────────────────
# JSON format recommended for ingestion into local SIEM/log systems
LOG_LEVEL=info
LOG_FORMAT=json
```

::: danger Do Not Use `localhost`
In production air-gapped deployments, `DECISION_LINK_BASE_URL` and `DASHBOARD_URL` must resolve to a hostname or IP accessible by all users on the network — not `localhost`.
:::

### 3.3 Use the Production Compose File

The `docker-compose.production.yml` file references pre-built images (via `image:`) instead of building from source (via `build:`). This is required on the air-gapped host since there is no source code or build toolchain available.

```bash
# Start services using the production compose file
docker compose -f docker-compose.production.yml up -d
```

::: details docker-compose.production.yml
```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: agentgate-postgres
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-agentgate}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-agentgate}
      POSTGRES_DB: ${POSTGRES_DB:-agentgate}
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-agentgate} -d ${POSTGRES_DB:-agentgate}"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: agentgate-redis
    ports:
      - "${REDIS_PORT:-6379}:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped

  server:
    image: agentgate-server:latest
    container_name: agentgate-server
    environment:
      PORT: 3000
      HOST: 0.0.0.0
      NODE_ENV: ${NODE_ENV:-production}
      DB_DIALECT: postgres
      DATABASE_URL: postgresql://${POSTGRES_USER:-agentgate}:${POSTGRES_PASSWORD:-agentgate}@postgres:5432/${POSTGRES_DB:-agentgate}
      REDIS_URL: redis://redis:6379
      RATE_LIMIT_BACKEND: redis
      ADMIN_API_KEY: ${ADMIN_API_KEY:?ADMIN_API_KEY is required}
      JWT_SECRET: ${JWT_SECRET:-}
      CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS:-*}
      DECISION_LINK_BASE_URL: ${DECISION_LINK_BASE_URL:-}
      DASHBOARD_URL: ${DASHBOARD_URL:-}
      RATE_LIMIT_ENABLED: ${RATE_LIMIT_ENABLED:-true}
      RATE_LIMIT_RPM: ${RATE_LIMIT_RPM:-60}
      REQUEST_TIMEOUT_SEC: ${REQUEST_TIMEOUT_SEC:-3600}
      WEBHOOK_TIMEOUT_MS: ${WEBHOOK_TIMEOUT_MS:-5000}
      WEBHOOK_MAX_RETRIES: ${WEBHOOK_MAX_RETRIES:-3}
      LOG_LEVEL: ${LOG_LEVEL:-info}
      LOG_FORMAT: ${LOG_FORMAT:-json}
      CHANNEL_ROUTES: ${CHANNEL_ROUTES:-[]}
    ports:
      - "${SERVER_PORT:-3000}:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      start_period: 10s
      retries: 3
    restart: unless-stopped

  dashboard:
    image: agentgate-dashboard:latest
    container_name: agentgate-dashboard
    ports:
      - "${DASHBOARD_PORT:-8080}:80"
    depends_on:
      server:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:80/"]
      interval: 30s
      timeout: 5s
      start_period: 5s
      retries: 3
    restart: unless-stopped

volumes:
  postgres-data:
  redis-data:
```
:::

### 3.4 Verify Deployment

```bash
# Check all containers are running
docker compose -f docker-compose.production.yml ps

# Verify health endpoint
curl http://localhost:3000/health
# Expected: {"status":"ok","timestamp":"..."}

# Check the dashboard
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080
# Expected: 200
```

## Notification Channels in Air-Gapped Environments

Not all notification channels work without internet access. Here's what to expect:

| Channel | Works Offline? | Notes |
|---------|:--------------:|-------|
| **Webhook** | ✅ | Only if the target URL is on the internal network |
| **Dashboard** | ✅ | Built-in, no external dependencies |
| **Email (SMTP)** | ✅ | If you have an internal SMTP relay |
| **Slack** | ❌ | Requires `api.slack.com` (internet) |
| **Discord** | ❌ | Requires `discord.com` (internet) |

### Recommended: Webhooks for Internal Automation

Webhooks are the primary integration mechanism in air-gapped environments. Point them at internal services:

```bash
# Route all notifications to an internal webhook endpoint
curl -X POST http://localhost:3000/api/webhooks \
  -H "Authorization: Bearer $AGENTGATE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://internal-automation.corp/agentgate-events",
    "events": ["request.created", "request.decided", "request.expired"],
    "secret": "your-webhook-secret"
  }'
```

### Channel Routing for Offline Channels

Configure `CHANNEL_ROUTES` to use only offline-compatible channels:

```bash
CHANNEL_ROUTES='[
  {
    "channel": "webhook",
    "target": "https://siem.internal.corp/agentgate",
    "enabled": true
  },
  {
    "channel": "email",
    "target": "ops-team@internal.corp",
    "urgencies": ["high", "critical"],
    "enabled": true
  }
]'
```

::: warning Do Not Configure Slack/Discord
Configuring Slack or Discord channels in an air-gapped environment will cause silent delivery failures and consume retry resources. Remove or disable these integrations.
:::

## Upgrading in Air-Gapped Environments

To upgrade AgentGate:

1. **On the connected machine**, pull the latest code and rebuild:

   ```bash
   cd agentgate
   git pull
   docker compose build
   ```

2. **Re-bundle** the images:

   ```bash
   docker save \
     agentgate-server \
     agentgate-dashboard \
     postgres:16-alpine \
     redis:7-alpine \
     | gzip > agentgate-bundle-v2.tar.gz
   ```

3. **Transfer** the new bundle to the air-gapped host.

4. **On the air-gapped host**, load and restart:

   ```bash
   docker load < agentgate-bundle-v2.tar.gz

   docker compose -f docker-compose.production.yml down
   docker compose -f docker-compose.production.yml up -d
   ```

5. **Verify** the upgrade:

   ```bash
   curl http://localhost:3000/health
   docker compose -f docker-compose.production.yml logs --tail=50 server
   ```

::: tip Database Migrations
Database migrations run automatically when the server starts. Always back up your database before upgrading:

```bash
docker compose -f docker-compose.production.yml exec postgres \
  pg_dump -U agentgate agentgate > backup-$(date +%Y%m%d).sql
```
:::

## Backup & Recovery

### Database Backup

```bash
# Create backup
docker compose -f docker-compose.production.yml exec postgres \
  pg_dump -U agentgate agentgate > agentgate-backup.sql

# Restore from backup
docker compose -f docker-compose.production.yml exec -T postgres \
  psql -U agentgate agentgate < agentgate-backup.sql
```

### Full Data Export

To export all persistent data:

```bash
# Stop services
docker compose -f docker-compose.production.yml down

# Backup volumes
docker run --rm \
  -v agentgate_postgres-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/postgres-volume.tar.gz -C /data .

docker run --rm \
  -v agentgate_redis-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/redis-volume.tar.gz -C /data .
```

## Troubleshooting

### Images not found after `docker load`

```
Error: No such image: agentgate-server:latest
```

**Cause:** The image names in the bundle don't match. Verify with:

```bash
docker images | grep agentgate
```

If images were built in a differently-named directory, they may have a prefix like `mydir-server`. Re-tag them:

```bash
docker tag mydir-server:latest agentgate-server:latest
docker tag mydir-dashboard:latest agentgate-dashboard:latest
```

### Decision links point to wrong host

If approval links in notifications show `localhost` or an unreachable host, update `DECISION_LINK_BASE_URL` in `.env`:

```bash
DECISION_LINK_BASE_URL=https://agentgate.internal.corp:3000
```

Then restart the server:

```bash
docker compose -f docker-compose.production.yml restart server
```

### Webhook delivery failures

Check that the target URL is reachable from the Docker network:

```bash
# From inside the server container
docker compose -f docker-compose.production.yml exec server \
  wget --spider --timeout=5 https://internal-automation.corp/health
```

### Container health check failing

```bash
# Check container logs
docker compose -f docker-compose.production.yml logs server

# Verify database connectivity
docker compose -f docker-compose.production.yml exec server \
  wget --spider --timeout=5 http://localhost:3000/health
```

## Security Considerations

- **Rotate credentials** — Generate unique `ADMIN_API_KEY` and `JWT_SECRET` values on the air-gapped host. Do not reuse keys from the connected machine.
- **Network policies** — Restrict container-to-container traffic. Only the `server` needs access to `postgres` and `redis`.
- **TLS termination** — Use a reverse proxy (nginx, HAProxy) for HTTPS. See the [Docker deployment guide](/docker#using-a-reverse-proxy) for examples.
- **Audit logging** — Enable `LOG_FORMAT=json` and forward logs to your SIEM via syslog or file-based collection.
- **Image provenance** — Verify image digests after loading to ensure bundle integrity:

  ```bash
  docker inspect --format='{{.Id}}' agentgate-server:latest
  ```

## Quick Reference

| Step | Command |
|------|---------|
| Build images | `docker compose build` |
| Save bundle | `docker save agentgate-server agentgate-dashboard postgres:16-alpine redis:7-alpine \| gzip > agentgate-bundle.tar.gz` |
| Load bundle | `docker load < agentgate-bundle.tar.gz` |
| Start services | `docker compose -f docker-compose.production.yml up -d` |
| Check health | `curl http://localhost:3000/health` |
| View logs | `docker compose -f docker-compose.production.yml logs -f` |
| Stop services | `docker compose -f docker-compose.production.yml down` |
| Backup database | `docker compose -f docker-compose.production.yml exec postgres pg_dump -U agentgate agentgate > backup.sql` |
