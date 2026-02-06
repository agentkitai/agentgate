---
title: 'AgentGate v0.5 — Review Fixes & Production Hardening'
slug: 'agentgate-review-fixes'
created: '2026-02-06'
status: 'in-progress'
stepsCompleted: []
tech_stack:
  - TypeScript 5.x
  - Hono 4.x
  - Drizzle ORM
  - SQLite (better-sqlite3) / PostgreSQL (postgres.js)
  - Redis (ioredis)
  - Node.js 20
  - Docker / Docker Compose
files_to_modify:
  - packages/mcp/src/tools.ts
  - packages/mcp/src/types.ts
  - packages/discord/src/bot.ts
  - packages/server/src/db/index.ts
  - packages/server/src/db/schema.sqlite.ts
  - packages/server/src/db/schema.postgres.ts
  - packages/server/src/index.ts
  - packages/server/src/config.ts
  - packages/server/src/routes/decide.ts
  - packages/server/src/routes/requests.ts
  - packages/server/src/lib/webhook.ts
  - packages/server/src/lib/api-keys.ts
  - packages/server/src/lib/notification/adapters/email.ts
  - packages/server/src/lib/notification/adapters/webhook.ts
  - packages/core/src/policy-engine.ts
  - packages/sdk/src/client.ts
  - .dockerignore
  - .github/workflows/release.yml
  - .github/workflows/ci.yml
  - .github/workflows/docker.yml
code_patterns:
  - 'Hono router handlers with Zod validation'
  - 'Drizzle ORM queries with eq/and operators'
  - 'Adapter pattern for notifications (email/slack/discord/webhook)'
  - 'Sync `db` export for SQLite backward compat, async `initDatabase()` for Postgres'
  - 'nanoid for ID generation, crypto.randomBytes for secrets'
test_patterns:
  - 'Vitest with workspace config'
  - 'Tests in packages/*/src/__tests__/'
  - '303 existing tests across 11 suites'
---

# Tech-Spec: AgentGate v0.5 — Review Fixes & Production Hardening

**Created:** 2026-02-06
**Source:** Code Review (agentgate-review.md) + Cloud Infrastructure Review (agentgate-cloud-review.md)
**Priority:** Critical — blocks enterprise deployment

---

## Overview

### Problem Statement

AgentGate v0.4 shipped with **critical broken features** (MCP decide always fails, Discord bot buttons always return 401), **security vulnerabilities** (race condition in decide endpoint, ReDoS in policy engine, HTML injection in emails, missing SSRF checks), **PostgreSQL mode that doesn't work** (sync `db` export throws for Postgres), and **zero production hardening** (no graceful shutdown, no structured logging, no database indexes, no auto-migrations).

Two comprehensive reviews (a code review finding 7 critical issues + a cloud/infrastructure review finding 45 issues) identified ~30 actionable items that must be fixed before GA.

### Solution

A prioritized series of 5 epics containing 26 stories that fix all critical and high-priority findings from both reviews. Each story is self-contained with exact file paths, specific code changes, and Given/When/Then acceptance criteria.

### Scope

**In Scope:**
- All 🔴 Critical issues from both reviews (broken features, security, data integrity)
- All 🟠 High Priority issues (production readiness, indexes, logging)
- Selected 🟡 Medium Priority issues that are low-effort high-impact

**Out of Scope:**
- Branded types for IDs (nice-to-have, big refactor)
- Result type pattern for SDK (API change, defer to v0.6)
- SQLite→PostgreSQL data migration tool (L effort, defer)
- Prometheus metrics endpoint (M effort, defer to v0.6)
- SBOM generation (separate task)
- Container resource limits in docker-compose (ops task)

---

## Context for Development

### Codebase Patterns

1. **Router pattern:** Each route file exports a `Hono` router. Routes import `db` from `../db/index.js` and use Drizzle ORM queries directly. Validation is manual (not Zod middleware) with `validateXBody()` helper functions.

2. **Database access:** The `db` export from `packages/server/src/db/index.ts` is a synchronous SQLite initialization at module load time. For PostgreSQL, it returns a Proxy that throws. The async `initDatabase()` function exists but routes don't use it — they import the sync `db` directly.

3. **Notification system:** Adapter pattern — `EmailAdapter`, `SlackAdapter`, `DiscordAdapter`, `WebhookAdapter` all implement `NotificationChannelAdapter`. The `NotificationDispatcher` routes events to adapters based on `channelRoutes` config. `dispatchSync()` is fire-and-forget.

4. **Webhook delivery:** `lib/webhook.ts` is separate from notification webhooks. It delivers to registered webhooks (database-stored) with SSRF protection and `setTimeout`-based retries.

5. **Config:** Singleton loaded via `getConfig()`. Zod-validated from env vars via `ENV_MAP`. `logLevel` and `logFormat` are defined but never wired to a logger.

6. **Auth:** `authMiddleware` in `middleware/auth.ts` validates Bearer token against database API keys via `validateApiKey()`. The decide-by-token route (`/api/decide/:token`) is mounted before auth middleware (public).

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `packages/server/src/index.ts` | Server entrypoint — Hono app, middleware, route mounting, `serve()` |
| `packages/server/src/db/index.ts` | DB init — sync SQLite export, async `initDatabase()`, PostgreSQL support |
| `packages/server/src/db/schema.sqlite.ts` | SQLite schema — 7 tables, no indexes |
| `packages/server/src/db/schema.postgres.ts` | PostgreSQL schema — mirrors SQLite, some type inconsistencies |
| `packages/server/src/config.ts` | Zod config schema, `getConfig()`, `validateProductionConfig()` |
| `packages/server/src/routes/decide.ts` | Token-based one-click decide — GET `/api/decide/:token` |
| `packages/server/src/routes/requests.ts` | CRUD for approval requests + POST `/:id/decide` |
| `packages/server/src/lib/webhook.ts` | Webhook delivery with `setTimeout` retries |
| `packages/server/src/lib/api-keys.ts` | API key generation, validation, `lastUsedAt` update |
| `packages/server/src/lib/notification/adapters/email.ts` | Email adapter — HTML templates, SMTP transport |
| `packages/server/src/lib/notification/adapters/webhook.ts` | Webhook notification adapter — missing SSRF check |
| `packages/core/src/policy-engine.ts` | Pure policy evaluation — `$regex` matcher is ReDoS-vulnerable |
| `packages/mcp/src/tools.ts` | MCP tool handlers — `handleDecide()` missing `decidedBy` |
| `packages/mcp/src/types.ts` | MCP types — `DecideArgs` missing `decidedBy` field |
| `packages/discord/src/bot.ts` | Discord bot — button handler missing auth header |
| `packages/sdk/src/client.ts` | SDK client — `confirm()` method calls non-existent endpoint |
| `packages/server/Dockerfile` | 4-stage multi-stage build |
| `.github/workflows/release.yml` | CI — changesets publish, no tests, no Docker |

### Technical Decisions

1. **Atomic updates over transactions:** For the decide race condition, use `UPDATE ... WHERE status = 'pending'` and check affected rows, rather than wrapping in a transaction. This is simpler and works identically for both SQLite and PostgreSQL.

2. **`safe-regex2` over `re2`:** For ReDoS protection, use the pure-JS `safe-regex2` package to validate regex patterns at policy creation time, rather than the native `re2` package which has compilation dependencies. This keeps the install simple.

3. **`pino` for structured logging:** Lightweight, JSON-native, supports log levels. Better fit than winston for a server that needs structured logging without heavy dependencies.

4. **Database-level retry for webhooks:** Replace `setTimeout` retries with a periodic DB scan for failed deliveries. Simpler than adding BullMQ, survives restarts, works with both DB backends.

5. **Keep sync `db` export for SQLite:** Don't break backward compat. Instead, make `initDatabase()` the primary path in `index.ts` and have all routes receive `db` from Hono context for PostgreSQL support.

---

## Implementation Plan

### Epic 1: Critical Bug Fixes (Broken Features)

These stories fix features that are completely non-functional in the current codebase.

---

#### Story 1.1: Fix MCP Decide Handler — Add `decidedBy` Field

**Priority:** 🔴 Critical
**Effort:** XS (< 30 min)
**Review refs:** Code Review §3.2

**Problem:** The MCP `agentgate_decide` tool sends a decision without the `decidedBy` field. The server's `validateDecisionBody()` requires `decidedBy` and returns 400. **The MCP decide tool always fails.**

**Files to modify:**
- `packages/mcp/src/types.ts` — Add `decidedBy` to `DecideArgs`
- `packages/mcp/src/tools.ts` — Pass `decidedBy` in `handleDecide()` and add to tool input schema

**Changes:**

In `packages/mcp/src/types.ts`:
```typescript
export interface DecideArgs {
  id: string;
  decision: 'approved' | 'denied';
  reason?: string;
  decidedBy?: string;  // ADD THIS
}
```

In `packages/mcp/src/tools.ts` — tool definition for `agentgate_decide`, add to `properties`:
```typescript
decidedBy: { type: 'string', description: 'Who is making this decision (default: "mcp-user")' },
```

In `packages/mcp/src/tools.ts` — `handleDecide()` function:
```typescript
export async function handleDecide(
  config: ApiConfig,
  args: DecideArgs
): Promise<unknown> {
  return apiCall(config, 'POST', `/api/requests/${args.id}/decide`, {
    decision: args.decision,
    reason: args.reason,
    decidedBy: args.decidedBy ?? 'mcp-user',
  });
}
```

In `packages/mcp/src/tools.ts` — `handleToolCall()` switch case for `agentgate_decide`:
```typescript
case 'agentgate_decide':
  result = await handleDecide(config, {
    id: args.id as string,
    decision: args.decision as 'approved' | 'denied',
    reason: args.reason as string | undefined,
    decidedBy: args.decidedBy as string | undefined,
  });
  break;
```

Also fix: the `agentgate_request` tool definition has `urgency` enum `['low', 'normal', 'high']` but is missing `'critical'`. Add it.

**Acceptance Criteria:**
- **Given** an MCP client calls `agentgate_decide` with `{ id: "abc", decision: "approved" }`
- **When** the tool handler sends the request to the server
- **Then** the request body includes `decidedBy: "mcp-user"` (default) and the server returns 200
- **And** if the user provides `decidedBy: "alice"`, that value is used instead

---

#### Story 1.2: Fix Discord Bot — Add Auth Header to API Calls

**Priority:** 🔴 Critical
**Effort:** XS (< 30 min)
**Review refs:** Code Review §3.3

**Problem:** The Discord bot's button handler and `fetchDecisionTokens()` make API calls to the AgentGate server without an `Authorization` header. The server's auth middleware rejects all requests with 401. **All Discord button clicks fail.**

**Files to modify:**
- `packages/discord/src/bot.ts` — Add `apiKey` to options, include in all `fetch()` calls

**Changes:**

In `DiscordBotOptions` interface, add:
```typescript
/** AgentGate API key for authenticating bot requests */
apiKey?: string;
```

In `fetchDecisionTokens()`, add auth header:
```typescript
async function fetchDecisionTokens(
  agentgateUrl: string,
  requestId: string,
  apiKey?: string
): Promise<DecisionLinks | null> {
  // ...
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  const response = await fetch(`${agentgateUrl}/api/requests/${requestId}/tokens`, {
    method: "POST",
    headers,
  });
  // ...
}
```

In the button interaction handler (`Events.InteractionCreate`), add auth header to the decide call:
```typescript
const headers: Record<string, string> = { "Content-Type": "application/json" };
if (options.apiKey) {
  headers["Authorization"] = `Bearer ${options.apiKey}`;
}

const response = await fetch(`${agentgateUrl}/api/requests/${requestId}/decide`, {
  method: "POST",
  headers,
  body: JSON.stringify({ decision, decidedBy: userId }),
});
```

Update `sendApprovalRequest()` to pass `apiKey` to `fetchDecisionTokens()`:
```typescript
const fetchedLinks = await fetchDecisionTokens(agentgateUrl, request.id, options.apiKey);
```

**Acceptance Criteria:**
- **Given** a Discord bot is created with `createDiscordBot({ token, agentgateUrl, apiKey: "agk_..." })`
- **When** a user clicks the Approve button on a request notification
- **Then** the API call includes `Authorization: Bearer agk_...` and the server returns 200
- **And** the Discord message is updated with the decided embed

---

#### Story 1.3: Fix PostgreSQL Mode — Async DB Initialization

**Priority:** 🔴 Critical
**Effort:** M (2-4 hours)
**Review refs:** Code Review §4.2, Cloud Review #18

**Problem:** All route files import `{ db }` from `../db/index.js`. This sync export calls `initSqliteSync()` at module load time, which returns a throwing Proxy when `DB_DIALECT=postgres`. **PostgreSQL mode doesn't work at all.** Additionally, `lib/webhook.ts` and `lib/api-keys.ts` also import the sync `db`.

**Files to modify:**
- `packages/server/src/index.ts` — Call `initDatabase()` before starting server, set db in Hono context
- `packages/server/src/db/index.ts` — Export a `getDb()` function that returns the initialized db, remove auto-init from module load for postgres mode
- `packages/server/src/routes/requests.ts` — Use `getDb()` or context-based db
- `packages/server/src/routes/decide.ts` — Same
- `packages/server/src/routes/api-keys.ts` — Same
- `packages/server/src/routes/webhooks.ts` — Same
- `packages/server/src/routes/audit.ts` — Same
- `packages/server/src/routes/policies.ts` — Same
- `packages/server/src/routes/tokens.ts` — Same
- `packages/server/src/lib/webhook.ts` — Same
- `packages/server/src/lib/api-keys.ts` — Same
- `packages/server/src/lib/audit.ts` — Same
- `packages/server/src/lib/decision-tokens.ts` — Same
- `packages/server/src/middleware/auth.ts` — Same

**Approach:** Replace all `import { db } from '../db/index.js'` with `import { getDb } from '../db/index.js'` and call `getDb()` at the top of each handler. The `getDb()` function returns `_db` (set by `initDatabase()`) or throws if not initialized.

In `packages/server/src/db/index.ts`, rename the existing `getDatabase()` to `getDb()` (shorter, more ergonomic) and make it the primary API:

```typescript
/**
 * Get the initialized database instance.
 * Must call initDatabase() during startup before using this.
 */
export function getDb(): Database {
  if (!_db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return _db;
}
```

Keep the sync `db` export for backward compat but add a deprecation comment. The key change is in `index.ts`:

```typescript
// In index.ts, before serve():
const db = await initDatabase();
// Optionally run migrations here (see Story 1.4)
```

**Migration strategy for route files:** A simple find-and-replace:
- `import { db, ... } from "../db/index.js"` → `import { getDb, ... } from "../db/index.js"`
- `db.select()` → `getDb().select()`, `db.insert()` → `getDb().insert()`, etc.
- OR: alias at top of handler: `const db = getDb();`

**Acceptance Criteria:**
- **Given** the server is configured with `DB_DIALECT=postgres` and a valid `DATABASE_URL`
- **When** the server starts
- **Then** `initDatabase()` connects to PostgreSQL, all routes use the async-initialized db
- **And** all CRUD operations (create request, decide, list, audit) work correctly with PostgreSQL
- **Given** `DB_DIALECT=sqlite` (default)
- **Then** behavior is unchanged — SQLite works as before

---

#### Story 1.4: Add Auto-Migrations on Server Startup

**Priority:** 🔴 Critical
**Effort:** S (1-2 hours)
**Review refs:** Cloud Review #15

**Problem:** Migration files exist in `packages/server/drizzle/sqlite/` (5 migrations) and `drizzle/postgres/` (2 migrations), and they are copied into the Docker image, but the server never runs them. New deployments with an empty database will fail.

**Files to modify:**
- `packages/server/src/index.ts` — Add migration call after `initDatabase()`
- `packages/server/package.json` — Ensure `drizzle-kit` is a production dependency (or use `drizzle-orm/migrator`)

**Changes:**

In `packages/server/src/index.ts`, after calling `initDatabase()`:

```typescript
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { migrate as migratePg } from 'drizzle-orm/postgres-js/migrator';
import { getDialect } from './db/index.js';

// After initDatabase():
const dialect = getDialect();
if (dialect === 'sqlite') {
  const { default: migrateSync } = await import('drizzle-orm/better-sqlite3/migrator');
  migrateSync(db, { migrationsFolder: './drizzle/sqlite' });
} else {
  const { default: migratePg } = await import('drizzle-orm/postgres-js/migrator');
  await migratePg(db, { migrationsFolder: './drizzle/postgres' });
}
console.log('Database migrations complete.');
```

Note: The exact import path for Drizzle migrators may vary. Test both dialects.

**Acceptance Criteria:**
- **Given** a fresh deployment with an empty SQLite database
- **When** the server starts
- **Then** all 5 SQLite migrations are applied automatically and all tables exist
- **Given** a fresh PostgreSQL database
- **When** the server starts with `DB_DIALECT=postgres`
- **Then** all 2 PostgreSQL migrations are applied automatically
- **Given** a database that already has all migrations applied
- **When** the server starts
- **Then** no errors occur (idempotent)

---

### Epic 2: Security Hardening

---

#### Story 2.1: Atomic Update for Decision Endpoint — Fix Race Condition

**Priority:** 🔴 Critical
**Effort:** S (1 hour)
**Review refs:** Code Review §3.4, Cloud Review #35

**Problem:** Both `/api/requests/:id/decide` (in `requests.ts`) and `/api/decide/:token` (in `decide.ts`) use a read-then-write pattern without atomicity. Two concurrent decisions can both pass the `status !== "pending"` check and both write — last write wins silently.

**Files to modify:**
- `packages/server/src/routes/requests.ts` — Lines 180-215 (POST `/:id/decide`)
- `packages/server/src/routes/decide.ts` — Lines ~120-145 (GET `/:token`)

**Changes for `requests.ts` — POST `/:id/decide`:**

Replace the current read-check-write with an atomic conditional update:

```typescript
// Instead of: SELECT ... WHERE id = :id, check status, then UPDATE
// Do: UPDATE ... WHERE id = :id AND status = 'pending'

const now = new Date();
const result = await db
  .update(approvalRequests)
  .set({
    status: decision,
    decidedAt: now,
    decidedBy,
    decisionReason: reason || null,
    updatedAt: now,
  })
  .where(and(
    eq(approvalRequests.id, id),
    eq(approvalRequests.status, 'pending')
  ))
  .returning();

// For SQLite (no .returning()), use:
// Run the update, then check if the row was actually modified.
// SQLite: db.run() returns { changes: number }
// With Drizzle, check by re-reading:

if (result.length === 0) {
  // Re-read to determine current status for error message
  const current = await db.select().from(approvalRequests)
    .where(eq(approvalRequests.id, id)).limit(1);
  if (current.length === 0) {
    return c.json({ error: "Request not found" }, 404);
  }
  return c.json(
    { error: `Request already ${current[0]!.status}` },
    409
  );
}
```

**Note on SQLite:** Drizzle's `.returning()` works for SQLite (via `better-sqlite3`'s RETURNING clause support in SQLite 3.35+). Verify this works; if not, use a read-after-write check.

Apply the same pattern to `decide.ts` for the token-based decision.

**Acceptance Criteria:**
- **Given** a pending request with ID "abc"
- **When** two concurrent POST requests to `/api/requests/abc/decide` arrive (one approve, one deny)
- **Then** exactly one succeeds (200) and the other receives 409 Conflict
- **And** only one audit log entry and one webhook delivery are created

---

#### Story 2.2: Cross-Invalidate Decision Tokens After Use

**Priority:** 🟡 Medium
**Effort:** XS (< 30 min)
**Review refs:** Code Review §3.5

**Problem:** When the "Approve" one-click link is used, only that token is marked `usedAt`. The "Deny" token for the same request remains technically valid (though the status check catches it). This creates confusion in audit trails.

**Files to modify:**
- `packages/server/src/routes/decide.ts` — After marking the used token

**Changes:**

After the line that marks the used token (`await db.update(decisionTokens).set({ usedAt: now }).where(eq(decisionTokens.id, tokenRecord.id))`), add:

```typescript
// Invalidate all other tokens for this request
await db
  .update(decisionTokens)
  .set({ usedAt: now })
  .where(and(
    eq(decisionTokens.requestId, request.id),
    isNull(decisionTokens.usedAt)
  ));
```

Import `isNull` from `drizzle-orm` (already available — it's used in `api-keys.ts`).

**Acceptance Criteria:**
- **Given** a request with approve and deny tokens
- **When** the approve token is used
- **Then** both the approve token and the deny token have `usedAt` set
- **And** attempting to use the deny token returns "Already Used" (not "Already Decided")

---

#### Story 2.3: ReDoS Protection for `$regex` Policy Matcher

**Priority:** 🟡 Medium
**Effort:** S (1 hour)
**Review refs:** Code Review §3.6

**Problem:** `policy-engine.ts` compiles user-supplied regex strings via `new RegExp(matcher.$regex)`. A malicious regex like `(a+)+$` causes exponential backtracking.

**Files to modify:**
- `packages/core/src/policy-engine.ts` — Add regex safety check
- `packages/core/package.json` — Add `safe-regex2` dependency
- `packages/server/src/routes/policies.ts` — Validate regex at creation time

**Changes:**

Install: `pnpm --filter @agentgate/core add safe-regex2`

In `packages/core/src/policy-engine.ts`, modify the `$regex` handler:

```typescript
import isSafeRegex from 'safe-regex2';

// In matchValue():
if ('$regex' in matcher) {
  if (typeof value !== 'string') return false;
  try {
    if (!isSafeRegex(matcher.$regex)) {
      // Unsafe regex — treat as non-match rather than crashing
      return false;
    }
    const regex = new RegExp(matcher.$regex);
    return regex.test(value);
  } catch {
    return false;
  }
}
```

In `packages/server/src/routes/policies.ts`, add server-side validation when creating/updating policies — reject rules with unsafe `$regex` values:

```typescript
// In the POST handler, after parsing rules:
for (const rule of rules) {
  for (const [key, matcher] of Object.entries(rule.match)) {
    if (typeof matcher === 'object' && matcher !== null && '$regex' in matcher) {
      if (!isSafeRegex(matcher.$regex)) {
        return c.json({ error: `Unsafe regex in rule matcher for "${key}": ${matcher.$regex}` }, 400);
      }
    }
  }
}
```

**Acceptance Criteria:**
- **Given** a policy rule with `{ match: { action: { "$regex": "(a+)+$" } } }`
- **When** the policy is created via POST `/api/policies`
- **Then** the server returns 400 with "Unsafe regex" error
- **Given** an existing policy with an unsafe regex somehow in the DB
- **When** a request is evaluated against it
- **Then** the unsafe regex is treated as non-matching (not executed)

---

#### Story 2.4: HTML Escaping in Email Templates

**Priority:** 🟡 Medium
**Effort:** S (1 hour)
**Review refs:** Code Review §3.9

**Problem:** `buildRequestCreatedHtml()`, `buildRequestDecidedHtml()`, and `buildGenericHtml()` interpolate user-controlled values (`payload.action`, `payload.requestId`, `payload.reason`, `payload.decidedBy`, etc.) directly into HTML strings. An attacker who creates an approval request with `action: "<script>alert('xss')</script>"` injects JavaScript into emails.

**Files to modify:**
- `packages/server/src/lib/notification/adapters/email.ts`

**Changes:**

Add an `escapeHtml()` utility at the top of the file:

```typescript
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

Apply `escapeHtml()` to every user-controlled interpolation in the HTML templates:
- `${payload.action}` → `${escapeHtml(payload.action)}`
- `${payload.requestId}` → `${escapeHtml(payload.requestId)}`
- `${payload.decidedBy}` → `${escapeHtml(String(payload.decidedBy))}`
- `${payload.decidedByType}` → `${escapeHtml(String(payload.decidedByType))}`
- `${payload.reason}` → `${escapeHtml(String(payload.reason))}`
- `${payload.urgency}` → `${escapeHtml(String(payload.urgency))}`
- `${event.eventId}` → `${escapeHtml(event.eventId)}`
- `${payload.policyDecision.decision}` → `${escapeHtml(...)}`
- `${payload.policyDecision.policyId}` → `${escapeHtml(...)}`
- All interpolations in `buildGenericHtml()` as well

Also apply to `formatJson()` output since it renders inside `<pre>` tags:
```typescript
function formatJson(obj: Record<string, unknown>, maxLen = 500): string {
  const str = JSON.stringify(obj, null, 2);
  const truncated = str.length <= maxLen ? str : str.slice(0, maxLen - 3) + "...";
  return escapeHtml(truncated);
}
```

Also apply to the `htmlResponse()` function in `routes/decide.ts` for the decision page. Hono's `html` tagged template DOES escape interpolated values, so verify this — if it does, this file is safe. Add a comment confirming.

**Acceptance Criteria:**
- **Given** a request is created with `action: '<img src=x onerror=alert(1)>'`
- **When** an email notification is sent for this request
- **Then** the HTML email body contains `&lt;img src=x onerror=alert(1)&gt;` (escaped)
- **And** no executable HTML/JS is present in the email

---

#### Story 2.5: SSRF Protection for Webhook Notification Adapter

**Priority:** 🟡 Medium
**Effort:** XS (< 30 min)
**Review refs:** Code Review §3.8

**Problem:** The `WebhookAdapter.send()` in `notification/adapters/webhook.ts` validates URL format but does NOT use `validateWebhookUrl()` for SSRF protection. Notification webhook targets configured via `channelRoutes` bypass all SSRF checks.

**Files to modify:**
- `packages/server/src/lib/notification/adapters/webhook.ts`

**Changes:**

Add import at top:
```typescript
import { validateWebhookUrl } from '../../url-validator.js';
```

Replace the `new URL(target)` validation block with:
```typescript
// SSRF protection: validate the webhook URL
const validation = await validateWebhookUrl(target);
if (!validation.valid) {
  return {
    success: false,
    channel: this.type,
    target,
    error: `SSRF blocked: ${validation.error}`,
    timestamp,
  };
}
```

**Acceptance Criteria:**
- **Given** a channel route configured with `target: "http://169.254.169.254/latest/meta-data/"`
- **When** a notification is dispatched to this webhook
- **Then** the request is blocked with "SSRF blocked" error
- **And** no HTTP request is made to the metadata endpoint

---

#### Story 2.6: Require Admin API Key in Production

**Priority:** 🟠 High
**Effort:** XS (< 30 min)
**Review refs:** Cloud Review #20

**Problem:** `adminApiKey` is optional. `validateProductionConfig()` returns warnings but the server starts anyway. In production, a deployment without auth is a critical vulnerability.

**Files to modify:**
- `packages/server/src/index.ts` — Enforce production config validation

**Changes:**

After loading config, before starting the server:

```typescript
const config = getConfig();

// Enforce production security requirements
if (config.isProduction) {
  const warnings = validateProductionConfig(config);
  const criticalWarnings = warnings.filter(w => w.includes('ADMIN_API_KEY'));
  if (criticalWarnings.length > 0) {
    console.error('FATAL: Production security requirements not met:');
    criticalWarnings.forEach(w => console.error(`  - ${w}`));
    console.error('Set ADMIN_API_KEY environment variable (min 16 characters) to start in production mode.');
    process.exit(1);
  }
  // Log non-critical warnings
  warnings.filter(w => !w.includes('ADMIN_API_KEY')).forEach(w => console.warn(`Warning: ${w}`));
}
```

**Acceptance Criteria:**
- **Given** `NODE_ENV=production` and no `ADMIN_API_KEY` set
- **When** the server starts
- **Then** it exits with error code 1 and a clear error message
- **Given** `NODE_ENV=development` and no `ADMIN_API_KEY`
- **Then** the server starts normally (dev mode is permissive)

---

#### Story 2.7: Add Request Body Size Limits

**Priority:** 🟡 Medium
**Effort:** XS (< 30 min)
**Review refs:** Code Review §4.4

**Problem:** No body parser size limit. Attackers can send multi-MB JSON payloads that get JSON-serialized into the database.

**Files to modify:**
- `packages/server/src/index.ts`

**Changes:**

```typescript
import { bodyLimit } from 'hono/body-limit';

// Add after logger middleware, before routes:
app.use('/api/*', bodyLimit({ maxSize: 1024 * 1024 })); // 1MB limit
```

**Acceptance Criteria:**
- **Given** a POST request to `/api/requests` with a 2MB JSON body
- **When** the server processes the request
- **Then** it returns 413 Payload Too Large before parsing the body
- **Given** a normal request with a 1KB body
- **Then** it is processed normally

---

### Epic 3: Production Infrastructure

---

#### Story 3.1: Add Graceful Shutdown (SIGTERM/SIGINT Handler)

**Priority:** 🔴 Critical
**Effort:** S (1-2 hours)
**Review refs:** Cloud Review #2

**Problem:** The server has no signal handlers. On `docker stop`, active requests are lost, DB connections are not closed, rate limiter resources leak.

**Files to modify:**
- `packages/server/src/index.ts`

**Changes:**

The `serve()` function from `@hono/node-server` returns a Node.js `http.Server`. Capture it:

```typescript
const server = serve({
  fetch: app.fetch,
  port,
});

console.log(`AgentGate server running at http://localhost:${port}`);

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  // 1. Stop accepting new connections
  server.close(() => {
    console.log('HTTP server closed.');
  });
  
  // 2. Close database connections
  try {
    await closeDatabase();
    console.log('Database connections closed.');
  } catch (err) {
    console.error('Error closing database:', err);
  }
  
  // 3. Reset rate limiter (closes Redis connection if applicable)
  try {
    await resetRateLimiter();
    console.log('Rate limiter shut down.');
  } catch (err) {
    console.error('Error shutting down rate limiter:', err);
  }
  
  console.log('Graceful shutdown complete.');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Safety net: force exit after 10 seconds
process.on('SIGTERM', () => {
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000).unref();
});
```

Import `closeDatabase` from `./db/index.js` and `resetRateLimiter` from the rate limiter module.

**Acceptance Criteria:**
- **Given** the server is running with active connections
- **When** SIGTERM is sent (e.g., `docker stop`)
- **Then** the server stops accepting new connections
- **And** existing database connections are closed
- **And** the process exits cleanly within 10 seconds
- **And** the exit code is 0

---

#### Story 3.2: Persistent Webhook Retry Queue (Replace setTimeout)

**Priority:** 🔴 Critical
**Effort:** M (2-4 hours)
**Review refs:** Code Review §5.5, Cloud Review #31

**Problem:** `lib/webhook.ts` uses `setTimeout()` for retries. If the server restarts during a retry window, the retry is lost. Failed deliveries with `attempts < max` are never retried.

**Files to modify:**
- `packages/server/src/lib/webhook.ts` — Replace setTimeout with DB-based retry
- `packages/server/src/index.ts` — Start periodic retry scanner

**Changes:**

1. Remove `setTimeout` calls from `attemptDelivery()`. When delivery fails with `attempt < maxAttempts`, just update the DB record with `status: 'pending'` (instead of 'failed') and `nextRetryAt`:

```typescript
// In webhookDeliveries, we need a nextRetryAt field.
// For now, compute it: lastAttemptAt + backoff delay
// The retry scanner will pick it up.

await db.update(webhookDeliveries)
  .set({
    status: 'pending',  // Keep as pending for retry
    attempts: attempt,
    lastAttemptAt: Date.now(),
    responseBody: error instanceof Error ? error.message : 'Unknown error',
  })
  .where(eq(webhookDeliveries.id, deliveryId));
```

2. Add a periodic retry scanner that runs every 30 seconds:

```typescript
export function startRetryScanner(intervalMs = 30_000): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const now = Date.now();
      const maxAttempts = 3;
      
      // Find pending deliveries that are due for retry
      const pending = await db.select().from(webhookDeliveries)
        .where(and(
          eq(webhookDeliveries.status, 'pending'),
          sql`${webhookDeliveries.attempts} > 0`,  // Already attempted at least once
          sql`${webhookDeliveries.attempts} < ${maxAttempts}`,
          // Exponential backoff: lastAttemptAt + 2^attempts * 1000 < now
          sql`${webhookDeliveries.lastAttemptAt} + POWER(2, ${webhookDeliveries.attempts}) * 1000 < ${now}`
        ))
        .limit(10);  // Process in batches
      
      for (const delivery of pending) {
        // Re-fetch the webhook to get URL and secret
        const wh = await db.select().from(webhooks)
          .where(eq(webhooks.id, delivery.webhookId)).limit(1);
        if (wh.length === 0 || !wh[0]!.enabled) {
          await db.update(webhookDeliveries)
            .set({ status: 'failed', responseBody: 'Webhook disabled or deleted' })
            .where(eq(webhookDeliveries.id, delivery.id));
          continue;
        }
        
        const signature = signPayload(delivery.payload, wh[0]!.secret);
        await attemptDelivery(delivery.id, wh[0]!.url, delivery.payload, signature, delivery.attempts + 1);
      }
    } catch (err) {
      console.error('Webhook retry scanner error:', err);
    }
  }, intervalMs);
}
```

3. In `index.ts`, start the scanner after server starts and stop it on shutdown:

```typescript
const retryTimer = startRetryScanner();

// In shutdown():
clearInterval(retryTimer);
```

**Acceptance Criteria:**
- **Given** a webhook delivery fails on first attempt
- **When** the server restarts before the retry would have fired
- **Then** the retry scanner picks up the failed delivery after startup and retries it
- **And** retries respect exponential backoff (2s, 4s, 8s)
- **Given** a delivery has reached max attempts (3)
- **Then** it is marked `status: 'failed'` and not retried again

---

#### Story 3.3: Add Database Indexes

**Priority:** 🟠 High
**Effort:** S (1 hour)
**Review refs:** Code Review §5.1, Cloud Review #12

**Problem:** No indexes beyond primary keys. List queries with status/action filters, API key lookups by hash, audit log queries by requestId, and webhook delivery queries by webhookId all do full table scans.

**Files to modify:**
- `packages/server/src/db/schema.sqlite.ts` — Add index definitions
- `packages/server/src/db/schema.postgres.ts` — Same indexes
- New migration files for both dialects

**Changes for SQLite schema:**

```typescript
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// After the approvalRequests table definition:
export const idxRequestsStatus = index("idx_requests_status").on(approvalRequests.status);
export const idxRequestsAction = index("idx_requests_action").on(approvalRequests.action);
export const idxRequestsCreatedAt = index("idx_requests_created_at").on(approvalRequests.createdAt);

// After auditLogs:
export const idxAuditRequestId = index("idx_audit_request_id").on(auditLogs.requestId);

// After apiKeys:
export const idxApiKeysHash = index("idx_api_keys_hash").on(apiKeys.keyHash);

// After webhookDeliveries:
export const idxDeliveriesWebhookId = index("idx_deliveries_webhook_id").on(webhookDeliveries.webhookId);
export const idxDeliveriesStatus = index("idx_deliveries_status").on(webhookDeliveries.status);

// After decisionTokens (already has .unique() on token which creates index, but add requestId):
export const idxTokensRequestId = index("idx_tokens_request_id").on(decisionTokens.requestId);
```

Apply the same for PostgreSQL schema using `import { index } from "drizzle-orm/pg-core"`.

Generate new migration files:
```bash
cd packages/server
DB_DIALECT=sqlite pnpm drizzle-kit generate
DB_DIALECT=postgres pnpm drizzle-kit generate
```

**Acceptance Criteria:**
- **Given** a database with 10,000+ approval requests
- **When** `GET /api/requests?status=pending` is called
- **Then** the query uses the `idx_requests_status` index (verify via EXPLAIN)
- **And** response time is < 50ms (vs potential seconds without index)

---

#### Story 3.4: Wire Structured Logging (Replace console.*)

**Priority:** 🟠 High
**Effort:** M (2-4 hours)
**Review refs:** Cloud Review #26

**Problem:** `LOG_LEVEL` and `LOG_FORMAT` config options exist but are never used. All logging is `console.log`/`console.error` — unstructured, no levels, not queryable.

**Files to modify:**
- `packages/server/package.json` — Add `pino` dependency
- `packages/server/src/lib/logger.ts` — New file: create and export logger
- `packages/server/src/index.ts` — Initialize logger, replace console calls
- All files using `console.log`/`console.error` — Replace with logger calls

**Changes:**

1. Install: `pnpm --filter @agentgate/server add pino`

2. Create `packages/server/src/lib/logger.ts`:

```typescript
import pino from 'pino';
import { getConfig } from '../config.js';

let _logger: pino.Logger | null = null;

export function initLogger(): pino.Logger {
  const config = getConfig();
  
  _logger = pino({
    level: config.logLevel,
    transport: config.logFormat === 'pretty' 
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,  // JSON by default
  });
  
  return _logger;
}

export function getLogger(): pino.Logger {
  if (!_logger) {
    _logger = initLogger();
  }
  return _logger;
}
```

3. Install pino-pretty as a dev dependency: `pnpm --filter @agentgate/server add -D pino-pretty`

4. Replace `console.log` and `console.error` throughout the server package:
   - `console.log(...)` → `getLogger().info(...)`
   - `console.error(...)` → `getLogger().error(...)`
   - Key files: `index.ts`, `lib/webhook.ts`, `lib/notification/dispatcher.ts`, `lib/rate-limiter/redis.ts`, `middleware/auth.ts`

**Acceptance Criteria:**
- **Given** `LOG_FORMAT=json` and `LOG_LEVEL=info`
- **When** the server processes a request
- **Then** log output is valid JSON with `level`, `time`, `msg` fields
- **Given** `LOG_LEVEL=error`
- **Then** info-level messages are suppressed
- **And** all `console.log`/`console.error` calls in the server package are replaced

---

#### Story 3.5: Deep Health Check (Verify DB + Redis)

**Priority:** 🟠 High
**Effort:** S (1 hour)
**Review refs:** Cloud Review #25

**Problem:** `/health` returns `{ status: "ok" }` without checking any dependencies. The server can report healthy while the database is unreachable.

**Files to modify:**
- `packages/server/src/index.ts` — Enhance health check endpoint

**Changes:**

```typescript
app.get("/health", async (c) => {
  const deep = c.req.query("deep") === "true";
  
  if (!deep) {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  }
  
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};
  let overallHealthy = true;
  
  // Check database
  try {
    const start = Date.now();
    const db = getDb();
    // Simple query to verify connectivity
    if (getDialect() === 'sqlite') {
      await db.select({ one: sql`1` }).from(approvalRequests).limit(1);
    } else {
      await db.execute(sql`SELECT 1`);
    }
    checks.database = { status: 'healthy', latencyMs: Date.now() - start };
  } catch (err) {
    checks.database = { status: 'unhealthy', error: String(err) };
    overallHealthy = false;
  }
  
  // Check Redis (if configured)
  const config = getConfig();
  if (config.rateLimitBackend === 'redis' && config.redisUrl) {
    try {
      const start = Date.now();
      // Ping Redis via rate limiter
      const limiter = getRateLimiter();
      // If Redis-backed, this tests connectivity
      checks.redis = { status: 'healthy', latencyMs: Date.now() - start };
    } catch (err) {
      checks.redis = { status: 'unhealthy', error: String(err) };
      overallHealthy = false;
    }
  }
  
  const status = overallHealthy ? 'ok' : 'degraded';
  const httpStatus = overallHealthy ? 200 : 503;
  
  return c.json({ status, timestamp: new Date().toISOString(), checks }, httpStatus);
});
```

**Acceptance Criteria:**
- **Given** `GET /health` (no query param)
- **Then** returns `{ status: "ok" }` (backward compatible, fast)
- **Given** `GET /health?deep=true` with a healthy database
- **Then** returns `{ status: "ok", checks: { database: { status: "healthy", latencyMs: 5 } } }`
- **Given** `GET /health?deep=true` with database down
- **Then** returns 503 with `{ status: "degraded", checks: { database: { status: "unhealthy", error: "..." } } }`

---

#### Story 3.6: Create .dockerignore File

**Priority:** 🟠 High
**Effort:** XS (< 15 min)
**Review refs:** Cloud Review #1

**Problem:** No `.dockerignore` exists. The entire repo (including `node_modules/`, `.git/`, test files) is sent as Docker build context, bloating build times and risking secret leakage.

**Files to create:**
- `.dockerignore` (repo root)

**Content:**

```
# Version control
.git
.gitignore

# Dependencies (will be installed in Docker)
node_modules

# Build artifacts
**/dist
**/build

# Test files
**/__tests__
**/*.test.ts
**/*.spec.ts
coverage

# Development files
.env
.env.*
!.env.example
*.md
!README.md
LICENSE

# IDE
.vscode
.idea
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# BMAD artifacts
_bmad*

# Data
data/
*.db
```

**Acceptance Criteria:**
- **Given** a `docker build` command is run from the repo root
- **When** the build context is sent to the Docker daemon
- **Then** `.git/`, `node_modules/`, `.env`, test files, and build artifacts are excluded
- **And** build time is measurably faster (< 5s context transfer vs potentially minutes)

---

### Epic 4: Code Quality & Performance

---

#### Story 4.1: Batch `lastUsedAt` Writes for API Keys

**Priority:** 🟡 Medium
**Effort:** S (1-2 hours)
**Review refs:** Code Review §5.3

**Problem:** `validateApiKey()` in `api-keys.ts` runs a `UPDATE apiKeys SET lastUsedAt = ... WHERE id = ...` on EVERY authenticated request. Under high throughput, this creates write contention.

**Files to modify:**
- `packages/server/src/lib/api-keys.ts`

**Changes:**

Add an in-memory buffer that flushes `lastUsedAt` updates periodically:

```typescript
// Batch lastUsedAt updates
const lastUsedBuffer = new Map<string, number>();
let flushTimer: NodeJS.Timeout | null = null;

async function flushLastUsed(): Promise<void> {
  if (lastUsedBuffer.size === 0) return;
  
  const entries = Array.from(lastUsedBuffer.entries());
  lastUsedBuffer.clear();
  
  const db = getDb();
  for (const [id, timestamp] of entries) {
    await db.update(apiKeys)
      .set({ lastUsedAt: timestamp })
      .where(eq(apiKeys.id, id));
  }
}

export function startLastUsedFlusher(intervalMs = 60_000): NodeJS.Timeout {
  flushTimer = setInterval(() => {
    flushLastUsed().catch(err => console.error('Failed to flush lastUsedAt:', err));
  }, intervalMs);
  return flushTimer;
}

export function stopLastUsedFlusher(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  // Final flush
  flushLastUsed().catch(() => {});
}
```

In `validateApiKey()`, replace the direct update with:
```typescript
// Buffer lastUsedAt update (flushed periodically)
lastUsedBuffer.set(apiKey.id, Math.floor(Date.now() / 1000));
```

Start/stop the flusher in `index.ts` alongside other lifecycle events.

**Acceptance Criteria:**
- **Given** 100 API requests in 30 seconds using the same key
- **When** the flusher runs (every 60s)
- **Then** only 1 UPDATE query is executed for that key (not 100)
- **And** `lastUsedAt` is eventually consistent (within 60 seconds)

---

#### Story 4.2: Reuse Email Transporter

**Priority:** 🟡 Medium
**Effort:** XS (< 30 min)
**Review refs:** Code Review §5.4

**Problem:** `EmailAdapter.send()` creates a new `nodemailer.createTransport()` (new TCP connection) for every email. nodemailer transporters are designed to be reused.

**Files to modify:**
- `packages/server/src/lib/notification/adapters/email.ts`

**Changes:**

Add a cached transporter to the `EmailAdapter` class:

```typescript
export class EmailAdapter implements NotificationChannelAdapter {
  readonly type = "email" as const;
  private transporter: import("nodemailer").Transporter | null = null;

  private async getTransporter(): Promise<import("nodemailer").Transporter> {
    if (this.transporter) return this.transporter;
    
    const config = getConfig();
    const nodemailer = await import("nodemailer");
    
    this.transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort || 587,
      secure: config.smtpPort === 465,
      auth: config.smtpUser
        ? { user: config.smtpUser, pass: config.smtpPass }
        : undefined,
    });
    
    return this.transporter;
  }

  // In send(), replace `const transporter = nodemailer.createTransport(...)` with:
  // const transporter = await this.getTransporter();
```

**Acceptance Criteria:**
- **Given** 10 email notifications sent in sequence
- **When** the adapter processes them
- **Then** only 1 SMTP connection is established (reused for all 10)

---

#### Story 4.3: Remove SDK `confirm()` Method (Dead Code)

**Priority:** 🟡 Medium
**Effort:** XS (< 15 min)
**Review refs:** Code Review §4.5

**Problem:** The SDK has a `confirm()` method that POSTs to `/api/requests/:id/confirm`, but this endpoint doesn't exist on the server. Calling it always returns 404.

**Files to modify:**
- `packages/sdk/src/client.ts` — Remove `confirm()` method

**Changes:**

Remove the `confirm()` method (lines ~199-205) and add a comment noting it was removed:

```typescript
// confirm() was removed in v0.5 — the /api/requests/:id/confirm endpoint
// was never implemented. If you need action confirmation tracking, use
// the audit log endpoint instead.
```

**Acceptance Criteria:**
- **Given** the SDK is imported and used
- **When** TypeScript compiles
- **Then** `client.confirm()` no longer exists as a method
- **And** existing code calling `confirm()` gets a compile-time error (intentional — better than a runtime 404)

---

#### Story 4.4: Consolidate HTTP Client Implementations

**Priority:** 🟡 Medium
**Effort:** M (2-3 hours)
**Review refs:** Code Review §4.1

**Problem:** There are 4 separate HTTP client implementations: SDK `client.ts`, CLI `api.ts`, MCP `api.ts`, and GitHub Action `index.ts`. All implement the same Bearer token auth + JSON fetch pattern.

**Files to modify:**
- `packages/core/src/http-client.ts` — New shared HTTP client
- `packages/core/src/index.ts` — Export the new client
- `packages/mcp/src/api.ts` — Use shared client
- `packages/mcp/package.json` — Already depends on @agentgate/core

**Approach:** Create a minimal shared HTTP client in `@agentgate/core` (zero extra dependencies — uses native `fetch`). The SDK and CLI may keep their own implementations initially (they have more complex needs like polling), but MCP and Action should switch.

```typescript
// packages/core/src/http-client.ts
export class AgentGateHttpClient {
  constructor(
    private baseUrl: string,
    private apiKey?: string,
    private timeoutMs = 30_000
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let message = `AgentGate API error: ${response.status}`;
      try {
        const json = JSON.parse(text);
        message = json.error || json.message || message;
      } catch {}
      throw new Error(message);
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
}
```

Refactor `packages/mcp/src/api.ts` to use `AgentGateHttpClient`:

```typescript
import { AgentGateHttpClient } from '@agentgate/core';

export function apiCall(config: ApiConfig, method: string, path: string, body?: unknown) {
  const client = new AgentGateHttpClient(config.baseUrl, config.apiKey);
  return client.request(method, path, body);
}
```

**Acceptance Criteria:**
- **Given** `AgentGateHttpClient` is exported from `@agentgate/core`
- **When** MCP and Action packages import and use it
- **Then** all API calls work identically to before
- **And** the duplicated fetch logic in at least 2 packages is removed

---

### Epic 5: CI/CD & Deployment

---

#### Story 5.1: Add Test Step to CI Pipeline

**Priority:** 🟠 High
**Effort:** XS (< 30 min)
**Review refs:** Cloud Review #42

**Problem:** The release workflow builds but never runs `pnpm test`. Broken tests can ship to npm.

**Files to modify:**
- `.github/workflows/release.yml`

**Changes:**

Add a test step between `pnpm build` and the changesets action:

```yaml
      - name: Build packages
        run: pnpm build

      - name: Run tests
        run: pnpm test

      - name: Create Release Pull Request or Publish
```

**Acceptance Criteria:**
- **Given** a push to `main` with failing tests
- **When** the release workflow runs
- **Then** the workflow fails at the test step and does not publish

---

#### Story 5.2: Add PR Check Workflow

**Priority:** 🟡 Medium
**Effort:** S (30 min)
**Review refs:** Cloud Review #44

**Files to create:**
- `.github/workflows/ci.yml`

**Content:**

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  check:
    name: Lint, Build, Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      
      - name: Get pnpm store directory
        shell: bash
        run: echo "STORE_PATH=$(pnpm store path --silent)" >> $GITHUB_ENV
      
      - uses: actions/cache@v4
        with:
          path: ${{ env.STORE_PATH }}
          key: ${{ runner.os }}-pnpm-store-${{ hashFiles('**/pnpm-lock.yaml') }}
          restore-keys: ${{ runner.os }}-pnpm-store-
      
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm test
```

**Acceptance Criteria:**
- **Given** a PR is opened against `main`
- **When** the CI workflow runs
- **Then** it runs install, build, and test
- **And** the PR shows a required check status

---

#### Story 5.3: Docker Image Publishing Workflow

**Priority:** 🟠 High
**Effort:** M (1-2 hours)
**Review refs:** Cloud Review #43, #37

**Files to create:**
- `.github/workflows/docker.yml`

**Content:**

```yaml
name: Docker

on:
  push:
    tags: ['v*']
  workflow_dispatch:
    inputs:
      tag:
        description: 'Image tag (e.g., latest, v0.5.0)'
        required: true
        default: 'latest'

env:
  REGISTRY: ghcr.io
  IMAGE_PREFIX: ${{ github.repository_owner }}/agentgate

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    strategy:
      matrix:
        include:
          - package: server
            dockerfile: packages/server/Dockerfile
          - package: dashboard
            dockerfile: packages/dashboard/Dockerfile
    steps:
      - uses: actions/checkout@v4
      
      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_PREFIX }}-${{ matrix.package }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest,enable={{is_default_branch}}
      
      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          file: ${{ matrix.dockerfile }}
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

**Acceptance Criteria:**
- **Given** a new git tag `v0.5.0` is pushed
- **When** the Docker workflow runs
- **Then** `ghcr.io/<owner>/agentgate-server:0.5.0` and `ghcr.io/<owner>/agentgate-dashboard:0.5.0` are published
- **And** the `latest` tag is updated

---

#### Story 5.4: File-Based Secrets Support (`_FILE` Suffix)

**Priority:** 🟡 Medium
**Effort:** S (1 hour)
**Review refs:** Cloud Review #23

**Problem:** Secrets are ENV-only. Enterprise customers using Docker secrets need `_FILE` suffix support.

**Files to modify:**
- `packages/server/src/config.ts` — Add file-based secret loading

**Changes:**

Add a helper function before `loadFromEnv()`:

```typescript
import { readFileSync } from 'node:fs';

/**
 * For each env var, check if a _FILE variant exists.
 * If so, read the file contents as the value.
 * Example: ADMIN_API_KEY_FILE=/run/secrets/admin_key
 */
function resolveFileSecrets(): void {
  const secretKeys = [
    'ADMIN_API_KEY',
    'JWT_SECRET',
    'DATABASE_URL',
    'REDIS_URL',
    'SLACK_BOT_TOKEN',
    'SLACK_SIGNING_SECRET',
    'DISCORD_BOT_TOKEN',
    'SMTP_PASS',
  ];
  
  for (const key of secretKeys) {
    const fileKey = `${key}_FILE`;
    const filePath = process.env[fileKey];
    if (filePath && !process.env[key]) {
      try {
        process.env[key] = readFileSync(filePath, 'utf-8').trim();
      } catch (err) {
        console.error(`Warning: Could not read secret file for ${fileKey}: ${err}`);
      }
    }
  }
}
```

Call `resolveFileSecrets()` at the top of `loadFromEnv()`:

```typescript
function loadFromEnv(): Record<string, unknown> {
  resolveFileSecrets();
  // ... existing code
}
```

**Acceptance Criteria:**
- **Given** `ADMIN_API_KEY_FILE=/run/secrets/admin_key` is set and the file contains `mysecretkey1234567`
- **When** the config is loaded
- **Then** `config.adminApiKey` is `"mysecretkey1234567"`
- **Given** both `ADMIN_API_KEY` and `ADMIN_API_KEY_FILE` are set
- **Then** `ADMIN_API_KEY` takes precedence (explicit env var wins)

---

#### Story 5.5: Air-Gap Docker Image Bundle Documentation

**Priority:** 🟡 Medium
**Effort:** S (1 hour)
**Review refs:** Cloud Review #37, #39, #40

**Files to create:**
- `docs/deployment/air-gap.md`

**Content should cover:**
1. Building images locally: `docker compose build`
2. Saving images: `docker save agentgate-server agentgate-dashboard postgres:16-alpine redis:7-alpine | gzip > agentgate-bundle.tar.gz`
3. Loading on air-gapped host: `docker load < agentgate-bundle.tar.gz`
4. Configuring `DECISION_LINK_BASE_URL` to internal hostname
5. Notification channels that work offline (webhook only)
6. Using `docker-compose.production.yml` with `image:` instead of `build:`

**Acceptance Criteria:**
- **Given** a customer in an air-gapped environment
- **When** they follow the air-gap deployment guide
- **Then** they can load pre-built images, configure the stack, and run AgentGate without internet

---

## Additional Context

### Dependencies

**New npm dependencies:**
- `safe-regex2` → `@agentgate/core` (ReDoS protection, ~5KB, zero deps)
- `pino` → `@agentgate/server` (structured logging, ~150KB)
- `pino-pretty` → `@agentgate/server` devDependency (dev formatting)

**No new infrastructure required.** All changes work with existing SQLite/PostgreSQL/Redis setup.

### Testing Strategy

1. **Unit tests:** Each story should include or update tests. Priority:
   - Story 2.1 (race condition): Test with concurrent requests
   - Story 2.3 (ReDoS): Test with known-unsafe regex patterns
   - Story 1.1 & 1.2: Test that API calls include required fields/headers

2. **Integration tests:** After Epic 1, run the full test suite against both SQLite and PostgreSQL backends.

3. **Manual verification:**
   - Story 1.3: Spin up with `DB_DIALECT=postgres` and exercise all endpoints
   - Story 3.1: Send SIGTERM and verify clean shutdown
   - Story 3.2: Kill server during webhook retry, restart, verify retry resumes

4. **Existing tests:** 303 tests pass. The 7 failing suites are due to Node.js native module mismatch — fix with `pnpm rebuild better-sqlite3` (not in scope, tracked separately).

### Story Execution Order

**Recommended execution sequence** (respects dependencies):

1. **Story 3.6** — `.dockerignore` (no deps, instant win)
2. **Story 1.3** — Fix PostgreSQL mode (foundational — many other stories touch `db`)
3. **Story 1.4** — Auto-migrations (builds on 1.3)
4. **Story 1.1** — Fix MCP decide (quick win)
5. **Story 1.2** — Fix Discord bot (quick win)
6. **Story 2.1** — Atomic decide (security critical)
7. **Story 2.2** — Cross-invalidate tokens (small, pairs with 2.1)
8. **Story 2.6** — Require admin API key in production (quick security win)
9. **Story 2.7** — Body size limits (quick security win)
10. **Story 2.5** — SSRF in webhook adapter (quick security win)
11. **Story 2.4** — HTML escaping in emails (security)
12. **Story 2.3** — ReDoS protection (security)
13. **Story 3.1** — Graceful shutdown (infrastructure)
14. **Story 3.3** — Database indexes (performance)
15. **Story 3.4** — Structured logging (infrastructure)
16. **Story 3.5** — Deep health check (infrastructure)
17. **Story 3.2** — Persistent webhook retries (infrastructure)
18. **Story 4.1** — Batch lastUsedAt (performance)
19. **Story 4.2** — Reuse email transporter (performance)
20. **Story 4.3** — Remove SDK confirm (cleanup)
21. **Story 4.4** — Consolidate HTTP clients (cleanup)
22. **Story 5.1** — Tests in CI (CI/CD)
23. **Story 5.2** — PR check workflow (CI/CD)
24. **Story 5.3** — Docker publishing (CI/CD)
25. **Story 5.4** — File-based secrets (CI/CD)
26. **Story 5.5** — Air-gap docs (documentation)

### Notes

- **Hono's `html` tagged template:** Verify whether it auto-escapes interpolated values. If it does, Story 2.4's changes to `decide.ts` `htmlResponse()` may be unnecessary. Still apply escaping in email templates regardless (emails don't use Hono's html helper).
- **Drizzle `.returning()`:** Works for PostgreSQL natively. For SQLite, requires SQLite ≥ 3.35.0 (2021-03-12) which is available in `better-sqlite3` v9+. Verify the installed version.
- **PostgreSQL connection pooling (Cloud Review #17):** Deferred to v0.6. The `postgres` npm package defaults to 10 connections which is acceptable for initial deployment.
- **Redis `KEYS` → `SCAN` (Cloud Review #30):** Deferred — `clearAll()` is only called in tests/admin operations, not production hot path.
