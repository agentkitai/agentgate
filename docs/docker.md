# Docker Deployment

AgentGate provides Docker images for easy self-hosted deployments.

## Quick Start

### 1. Clone and Configure

```bash
git clone https://github.com/your-org/agentgate.git
cd agentgate

# Copy environment file
cp .env.example .env
```

### 2. Generate Credentials

```bash
# Generate admin API key (required)
echo "ADMIN_API_KEY=$(openssl rand -hex 32)" >> .env

# Generate JWT secret (recommended)
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
```

### 3. Start Services

```bash
docker-compose up -d
```

### 4. Access

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:8080 |
| API Server | http://localhost:3000 |
| Health Check | http://localhost:3000/health |

## Services

The docker-compose configuration includes:

| Service | Description | Port |
|---------|-------------|------|
| `server` | AgentGate API server | 3000 |
| `dashboard` | Web dashboard (nginx) | 8080 |
| `postgres` | PostgreSQL database | 5432 |
| `redis` | Redis (rate limiting, queues) | 6379 |

## Including the Slack Bot

To include the Slack bot service:

```bash
# Set Slack credentials in .env first
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_SIGNING_SECRET=your-signing-secret

# Start with bots profile
docker-compose --profile bots up -d
```

## Configuration

All configuration is via environment variables in `.env`:

**Required:**
- `ADMIN_API_KEY` — Admin API key (min 16 characters)

**Recommended for production:**
- `JWT_SECRET` — JWT signing secret (min 32 characters)
- `CORS_ORIGINS` — Restrict to your domain(s)
- `POSTGRES_PASSWORD` — Use a strong password

See [Configuration](/configuration) for all options.

## Building Images

Build all images locally:

```bash
docker-compose build
```

Build a specific service:

```bash
docker-compose build server
docker-compose build dashboard
```

## Database Migrations

Migrations run automatically when the server starts. For manual control:

```bash
docker-compose exec server node -e "
  import('./dist/db/migrate.js').then(m => m.runMigrations())
"
```

## Viewing Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f server

# Last 100 lines
docker-compose logs --tail=100 server
```

## Stopping Services

```bash
# Stop all
docker-compose down

# Stop and remove volumes (WARNING: deletes data)
docker-compose down -v
```

## Production Deployment

### Using a Reverse Proxy

For production, use a reverse proxy like nginx, Caddy, or Traefik for TLS:

```nginx
# nginx example
server {
    listen 443 ssl http2;
    server_name agentgate.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Dashboard
    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # API
    location /api {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Docker Secrets

For sensitive values in production, use Docker secrets:

```yaml
# docker-compose.override.yml
services:
  server:
    secrets:
      - admin_api_key
      - jwt_secret
    environment:
      ADMIN_API_KEY_FILE: /run/secrets/admin_api_key
      JWT_SECRET_FILE: /run/secrets/jwt_secret

secrets:
  admin_api_key:
    external: true
  jwt_secret:
    external: true
```

### Health Checks

Monitor the `/health` endpoint for uptime checks:

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"..."}
```

### Backups

Back up the PostgreSQL data volume regularly:

```bash
# Backup
docker-compose exec postgres pg_dump -U agentgate agentgate > backup.sql

# Restore
docker-compose exec -T postgres psql -U agentgate agentgate < backup.sql
```

## Production Checklist

- [ ] Use a reverse proxy for TLS termination
- [ ] Set strong passwords for PostgreSQL
- [ ] Restrict CORS origins to your domain
- [ ] Use Docker secrets for sensitive values
- [ ] Set up regular database backups
- [ ] Configure monitoring for health endpoints
- [ ] Set `LOG_FORMAT=json` for structured logging
