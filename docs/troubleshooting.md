# Troubleshooting Guide

This guide covers common issues when running AgentGate, organized by **Symptom → Cause → Solution**.

---

## Table of Contents

- [Webhook Failures](#webhook-failures)
- [429 Rate Limit Errors](#429-rate-limit-errors)
- [Decision Token Errors](#decision-token-errors)
- [Slack Bot Not Posting](#slack-bot-not-posting)
- [Discord Bot Not Responding](#discord-bot-not-responding)
- [Policies Not Matching](#policies-not-matching)
- [Database Migration Failures](#database-migration-failures)
- [Docker Networking Issues](#docker-networking-issues)

---

## Webhook Failures

### Symptom: Webhook deliveries silently fail

**Cause:** The webhook URL is unreachable from the server, or the target returns a non-2xx status code.

**Solution:**
1. Check webhook delivery status via `GET /api/webhooks` — each webhook tracks delivery attempts.
2. Verify the URL is reachable from the server container (see [Docker Networking](#docker-networking-issues)).
3. Check that `WEBHOOK_TIMEOUT_MS` (default: `5000`) is sufficient for your endpoint. Increase if your endpoint is slow:
   ```bash
   WEBHOOK_TIMEOUT_MS=10000
   ```
4. Failed deliveries are retried via a DB-based retry scanner (runs every 30s) with exponential backoff: `2^attempt × 1000ms` — so attempt 1 retries after ~2s, attempt 2 after ~4s, attempt 3 after ~8s. Maximum 3 total attempts (1 initial + 2 retries). Check server logs for retry attempts.

### Symptom: Webhook signature verification fails on receiver

**Cause:** The `secret` used when creating the webhook doesn't match what the receiver is using to verify `X-AgentGate-Signature`.

**Solution:**
1. The signature is `HMAC-SHA256(secret, raw_body)` — ensure you're hashing the raw request body, not a parsed/re-serialized version.
2. Re-create the webhook with a known secret if unsure.
3. If using `WEBHOOK_ENCRYPTION_KEY`, note that this encrypts secrets **at rest** in the database — it does not affect the HMAC signature sent to your endpoint.

### Symptom: `Invalid webhook URL` error (400)

**Cause:** AgentGate validates webhook URLs against SSRF attacks. Private/internal IPs and non-HTTP(S) schemes are rejected.

**Solution:**
- Use a publicly routable URL or a DNS name that resolves to a public IP.
- In development, if you need to target `localhost`, you may need to use the Docker service name (e.g., `http://host.docker.internal:4000`).

---

## 429 Rate Limit Errors

### Symptom: API returns `429 Too Many Requests`

**Cause:** The API key has exceeded its per-minute request limit.

**Solution:**
1. Check the rate limit headers in the response:
   - `X-RateLimit-Limit` — max requests per minute
   - `X-RateLimit-Remaining` — remaining in current window
   - `X-RateLimit-Reset` — seconds until window resets
2. Wait for the reset window, then retry.
3. Increase the per-key rate limit via `POST /api/keys` (set `rateLimit` to a higher value, or `null` for unlimited).
4. The global default is controlled by `RATE_LIMIT_RPM` (default: `60`). Adjust if needed:
   ```bash
   RATE_LIMIT_RPM=120
   ```
5. To disable rate limiting entirely (not recommended for production):
   ```bash
   RATE_LIMIT_ENABLED=false
   ```

### Symptom: Rate limiting not working (no 429s despite high traffic)

**Cause:** Rate limiting may be disabled, or using the `memory` backend which resets on server restart and doesn't share state across instances.

**Solution:**
1. Verify `RATE_LIMIT_ENABLED=true` (default).
2. For multi-instance deployments, switch to Redis backend:
   ```bash
   RATE_LIMIT_BACKEND=redis
   REDIS_URL=redis://redis:6379
   ```

---

## Decision Token Errors

### Symptom: `This decision link has expired`

**Cause:** Decision tokens have a configurable TTL. Default is 24 hours (`DECISION_TOKEN_EXPIRY_HOURS=24`).

**Solution:**
1. Request a new approval — the agent or user must create a new request.
2. Increase the token expiry if your approval workflows are long-running:
   ```bash
   DECISION_TOKEN_EXPIRY_HOURS=72
   ```

### Symptom: `This decision link is invalid or has been removed`

**Cause:** The token was already used, doesn't exist, or was cleaned up by the retention policy.

**Solution:**
1. Each decision token is **single-use**. Once a request is approved or denied, all sibling tokens are cross-invalidated.
2. Check if the request was already decided: `GET /api/requests/:id`.
3. Expired tokens are cleaned up after `CLEANUP_RETENTION_DAYS` (default: `30`).

### Symptom: `This request has already been approved/denied` (409)

**Cause:** Another approver (via dashboard, Slack, Discord, or another token) already decided this request.

**Solution:**
- This is expected behavior — AgentGate uses atomic conditional updates to prevent double-decisions. Check the request status via `GET /api/requests/:id` to see who decided and when.

---

## Slack Bot Not Posting

### Symptom: Slack bot starts but doesn't post approval requests

**Cause:** Missing or incorrect channel configuration, or the bot lacks permissions.

**Solution:**
1. Ensure required environment variables are set:
   ```bash
   SLACK_BOT_TOKEN=xoxb-...        # Bot User OAuth Token
   SLACK_SIGNING_SECRET=...         # From Slack app settings
   AGENTGATE_API_KEY=agk_...       # API key for server communication
   ```
2. Set a default channel: `SLACK_DEFAULT_CHANNEL=C01234ABCDE` (use channel ID, not name).
3. Verify the bot is invited to the channel (`/invite @YourBot` in Slack).
4. Check the bot has these OAuth scopes: `chat:write`, `channels:read`, `groups:read`.
5. Review bot logs — the bot prints configuration status on startup (✓/✗ for each setting).

### Symptom: Slack bot crashes on startup with `Missing SLACK_BOT_TOKEN`

**Cause:** The `SLACK_BOT_TOKEN` environment variable is not set.

**Solution:**
- Set the token from your Slack app's **OAuth & Permissions** page.
- If using Docker secrets, use `SLACK_BOT_TOKEN_FILE` pointing to the secret file.

### Symptom: Slack interactive buttons don't work

**Cause:** Slack can't reach the bot's HTTP endpoint for interactivity.

**Solution:**
1. The Slack bot runs on `SLACK_BOT_PORT` (default: `3001`). Ensure this port is accessible from the internet (or use a tunnel like ngrok in development).
2. Set the **Request URL** in your Slack app's Interactivity settings to point to the bot.

---

## Discord Bot Not Responding

### Symptom: Discord bot starts but doesn't post or respond to buttons

**Cause:** Missing bot token, wrong channel ID, or insufficient bot permissions.

**Solution:**
1. Ensure required environment variables are set:
   ```bash
   DISCORD_BOT_TOKEN=...              # Bot token from Discord Developer Portal
   AGENTGATE_URL=http://localhost:3000 # AgentGate server URL
   ```
2. Set a default channel: `DISCORD_CHANNEL_ID=123456789012345678`.
3. Verify the bot has these permissions in the target channel:
   - Send Messages
   - Embed Links
   - Use External Emojis
   - Read Message History
4. Ensure the bot is added to your server with the correct OAuth2 scopes (`bot`, `applications.commands`).

### Symptom: Discord bot crashes with `Missing DISCORD_BOT_TOKEN`

**Cause:** The `DISCORD_BOT_TOKEN` environment variable is not set.

**Solution:**
- Get the token from **Discord Developer Portal → Bot → Token**.
- If using Docker secrets, use `DISCORD_BOT_TOKEN_FILE`.

### Symptom: Decision links in Discord messages don't work

**Cause:** `DECISION_LINK_BASE_URL` is not configured, so the bot can't generate clickable approve/deny URLs.

**Solution:**
1. Set the base URL to your AgentGate server's public address:
   ```bash
   DECISION_LINK_BASE_URL=https://gate.example.com
   ```
2. To disable links entirely: `DISCORD_INCLUDE_LINKS=false`.

---

## Policies Not Matching

### Symptom: Requests always go to `pending` even though a matching policy exists

**Cause:** Policy priority ordering, disabled policies, or match criteria not aligning with the request.

**Solution:**
1. List policies via `GET /api/policies` and verify:
   - The policy is `enabled: true`.
   - The `priority` is correct — **lower numbers = higher priority**. The first matching policy wins.
   - The `match` criteria actually match the request's `action`, `params`, or `context`.
2. Check match syntax:
   - Exact match: `{ "action": "send_email" }`
   - Regex match: `{ "action": { "$regex": "^send_" } }` — note that regex patterns are validated for ReDoS safety; overly complex patterns are rejected.
3. Review the audit trail (`GET /api/requests/:id/audit`) to see which policy was evaluated.

### Symptom: `Unsafe regex pattern` error when creating a policy

**Cause:** AgentGate uses `safe-regex2` to reject patterns vulnerable to ReDoS (Regular Expression Denial of Service).

**Solution:**
- Simplify the regex. Avoid nested quantifiers like `(a+)+` or `(a|b)*c*`.
- Use exact string matches when possible — they're faster and safer.

---

## Database Migration Failures

### Symptom: Server fails to start with database errors

**Cause:** Migrations haven't been run, or there's a schema mismatch.

**Solution:**
1. **SQLite (default):** Run migrations manually:
   ```bash
   pnpm --filter @agentgate/server db:migrate
   ```
2. **PostgreSQL:** Ensure the database exists and is reachable:
   ```bash
   DB_DIALECT=postgres
   DATABASE_URL=postgresql://agentgate:agentgate@localhost:5432/agentgate
   ```
3. In Docker, migrations run automatically on server startup. Check server logs for migration errors:
   ```bash
   docker-compose logs server | grep -i migrat
   ```

### Symptom: `SQLITE_CANTOPEN` or permission errors

**Cause:** The SQLite database file path is not writable.

**Solution:**
1. Default path is `./data/agentgate.db`. Ensure the `data/` directory exists and is writable.
2. In Docker, the data directory is mounted as a volume. Verify volume permissions.

### Symptom: PostgreSQL `connection refused`

**Cause:** PostgreSQL is not running or the connection string is wrong.

**Solution:**
1. Verify PostgreSQL is healthy:
   ```bash
   docker-compose ps postgres
   docker-compose logs postgres
   ```
2. Check `DATABASE_URL` format: `postgresql://USER:PASSWORD@HOST:PORT/DBNAME`.
3. In Docker Compose, use the service name as host: `postgresql://agentgate:agentgate@postgres:5432/agentgate`.

---

## Docker Networking Issues

### Symptom: Server can't connect to PostgreSQL or Redis

**Cause:** Services are on different Docker networks, or using `localhost` instead of Docker service names.

**Solution:**
1. Use Docker Compose service names for inter-container communication:
   ```bash
   DATABASE_URL=postgresql://agentgate:agentgate@postgres:5432/agentgate
   REDIS_URL=redis://redis:6379
   ```
2. All services must be on the same network. The default `docker-compose.yml` uses `agentgate-internal` for backend services and `agentgate-public` for exposed services.
3. **Never use `localhost`** inside containers to reach other containers — `localhost` refers to the container itself.

### Symptom: Dashboard can't reach the API server

**Cause:** The dashboard (nginx) proxies API requests to the server container. If the server isn't running or isn't on the same network, requests fail.

**Solution:**
1. Verify both services are running: `docker-compose ps`.
2. The dashboard typically expects the API at `http://server:3000` via Docker networking. Check the nginx config in the dashboard image.
3. If accessing the dashboard from outside Docker, ensure `CORS_ALLOWED_ORIGINS` includes the dashboard's public URL.

### Symptom: Bot containers can't reach the AgentGate server

**Cause:** Bot services (Slack, Discord) need to communicate with the server over the Docker network.

**Solution:**
1. Set `AGENTGATE_URL=http://server:3000` in the bot container environment.
2. Ensure bot services are on the `agentgate-internal` network (they should be if using the `--profile bots` flag).
3. Verify with:
   ```bash
   docker-compose exec slack wget -qO- http://server:3000/health
   ```

---

## General Debugging Tips

### Check server health
```bash
curl http://localhost:3000/health
```

### View structured logs
Set `LOG_LEVEL=debug` and `LOG_FORMAT=json` for detailed, parseable logs:
```bash
LOG_LEVEL=debug LOG_FORMAT=json pnpm --filter @agentgate/server dev
```

### Validate configuration
The server validates all environment variables at startup using Zod schemas. If a required variable is missing or invalid, the error message will indicate which field failed validation.

### File-based secrets
For Docker deployments, use `_FILE` suffixed environment variables to read secrets from mounted files (e.g., `ADMIN_API_KEY_FILE=/run/secrets/admin_api_key`). The explicit env var takes precedence if both are set.

### Production checklist
Run `NODE_ENV=production` to enable production validations. The server will warn if:
- `ADMIN_API_KEY` is not set
- `JWT_SECRET` is not set
- `CORS_ALLOWED_ORIGINS` is not configured
- `WEBHOOK_ENCRYPTION_KEY` is not set
