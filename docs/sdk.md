# TypeScript SDK

The `@agentgate/sdk` package provides a type-safe client for AI agents to request human approvals.

## Installation

```bash
npm install @agentgate/sdk
# or
pnpm add @agentgate/sdk
# or
yarn add @agentgate/sdk
```

## Quick Start

```typescript
import { AgentGateClient } from '@agentgate/sdk'

const client = new AgentGateClient({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.AGENTGATE_API_KEY,
})

// Request approval for an action
const request = await client.request({
  action: 'send_email',
  params: { to: 'customer@example.com' },
  context: { dealValue: 50000 },
})

console.log(`Request ${request.id} created, waiting for approval...`)

// Wait for human decision
const decided = await client.waitForDecision(request.id, {
  timeout: 5 * 60 * 1000, // 5 minutes
})

if (decided.status === 'approved') {
  console.log('Approved! Sending email...')
  await sendEmail(decided.params)
} else if (decided.status === 'denied') {
  console.log('Request denied:', decided.decisionReason)
}
```

## API Reference

### Constructor

```typescript
new AgentGateClient({
  baseUrl: string,    // Required: URL of your AgentGate server
  apiKey?: string     // Optional: API key for authentication
})
```

### Methods

#### `request(options)`

Submit an approval request. Returns immediately with the created request.

```typescript
const request = await client.request({
  action: 'send_email',           // Required: action identifier
  params: { to: 'user@email.com' }, // Optional: action parameters
  context: { reason: 'Follow up' }, // Optional: contextual info
  urgency: 'high',                // Optional: 'low' | 'normal' | 'high' | 'critical'
  expiresAt: new Date(Date.now() + 3600000) // Optional: expiration time
})
```

**Returns:** `Promise<ApprovalRequest>`

#### `getRequest(id)`

Get an approval request by ID.

```typescript
const request = await client.getRequest('req_123')
```

**Returns:** `Promise<ApprovalRequest>`

#### `waitForDecision(id, options?)`

Poll until a decision is made or timeout is reached.

```typescript
const decided = await client.waitForDecision('req_123', {
  timeout: 300000,     // 5 minutes (default)
  pollInterval: 2000   // 2 seconds (default)
})
```

**Returns:** `Promise<ApprovalRequest>`  
**Throws:** `TimeoutError` if timeout is reached

#### `listRequests(options?)`

List approval requests with optional filters.

```typescript
const requests = await client.listRequests({
  status: 'pending',    // Filter by status
  action: 'send_email', // Filter by action
  limit: 10,            // Max results
  offset: 0             // Pagination offset
})
```

**Returns:** `Promise<ApprovalRequest[]>`

## Error Handling

```typescript
import { AgentGateError, TimeoutError } from '@agentgate/sdk'

try {
  await client.waitForDecision(id)
} catch (error) {
  if (error instanceof TimeoutError) {
    console.log('Timed out waiting for decision')
  } else if (error instanceof AgentGateError) {
    console.log(`API error: ${error.message} (${error.statusCode})`)
  }
}
```

## Types

All types from `@agentgate/core` are re-exported:

```typescript
import type {
  ApprovalRequest,
  ApprovalStatus,   // 'pending' | 'approved' | 'denied' | 'expired'
  ApprovalUrgency,  // 'low' | 'normal' | 'high' | 'critical'
  DecisionType,
  Policy,
  PolicyRule,
  PolicyDecision
} from '@agentgate/sdk'
```

## Usage Patterns

### Fire and Forget

Create a request without waiting:

```typescript
await client.request({
  action: 'notify_admin',
  params: { message: 'System alert' },
})
// Let webhooks or other integrations handle the notification
```

### With Timeout and Fallback

```typescript
try {
  const decided = await client.waitForDecision(request.id, {
    timeout: 60000, // 1 minute
  })
  
  if (decided.status === 'approved') {
    await performAction()
  }
} catch (error) {
  if (error instanceof TimeoutError) {
    // Auto-escalate or use a fallback
    console.log('No decision in time, escalating...')
  }
}
```

### Batch Requests

```typescript
const actions = [
  { action: 'delete_user', params: { id: 1 } },
  { action: 'delete_user', params: { id: 2 } },
]

const requests = await Promise.all(
  actions.map(a => client.request(a))
)

// Wait for all decisions
const decisions = await Promise.all(
  requests.map(r => client.waitForDecision(r.id))
)
```

### Policy Methods

#### `listPolicies()`

List all policies ordered by priority.

```typescript
const policies = await client.listPolicies()
```

**Returns:** `Promise<Policy[]>`

#### `getPolicy(id)`

Get a specific policy by ID.

```typescript
const policy = await client.getPolicy('pol_123')
```

**Returns:** `Promise<Policy>`

#### `createPolicy(options)`

Create a new policy.

```typescript
const policy = await client.createPolicy({
  name: 'Auto-approve low-risk emails',
  rules: [{ match: { action: 'send_email' }, decision: 'auto_approve' }],
  priority: 100,   // Optional (default: 100)
  enabled: true,    // Optional (default: true)
})
```

**Returns:** `Promise<Policy>`

#### `updatePolicy(id, options)`

Replace an existing policy (PUT semantics — all fields required).

```typescript
const updated = await client.updatePolicy('pol_123', {
  name: 'Updated policy',
  rules: [{ match: { action: 'send_email' }, decision: 'auto_approve' }],
  priority: 50,
  enabled: false,
})
```

**Returns:** `Promise<Policy>`

#### `deletePolicy(id)`

Delete a policy by ID.

```typescript
await client.deletePolicy('pol_123')
```

**Returns:** `Promise<void>`

---

### Webhook Methods

#### `listWebhooks()`

List all registered webhooks.

```typescript
const webhooks = await client.listWebhooks()
```

**Returns:** `Promise<Webhook[]>`

#### `createWebhook(options)`

Create a new webhook. The `secret` is only returned once — save it immediately.

```typescript
const wh = await client.createWebhook({
  url: 'https://example.com/webhook',
  events: ['request.approved', 'request.denied'],
  secret: 'optional-signing-secret', // Optional
})
console.log('Save this secret:', wh.secret)
```

**Returns:** `Promise<WebhookCreateResult>`

#### `updateWebhook(id, options)`

Update a webhook (PATCH semantics — only provided fields are changed).

```typescript
await client.updateWebhook('wh_123', {
  url: 'https://new-url.com/hook',   // Optional
  events: ['request.created'],        // Optional
  enabled: false,                     // Optional
})
```

**Returns:** `Promise<{ success: boolean }>`

#### `deleteWebhook(id)`

Delete a webhook by ID.

```typescript
await client.deleteWebhook('wh_123')
```

**Returns:** `Promise<void>`

#### `testWebhook(id)`

Send a test payload to a webhook to verify delivery.

```typescript
const result = await client.testWebhook('wh_123')
console.log(result.success ? 'Delivered!' : 'Failed:', result.message)
```

**Returns:** `Promise<WebhookTestResult>`

---

### Audit Methods

#### `listAuditLogs(options?)`

List audit log entries with optional filters and pagination.

```typescript
const audit = await client.listAuditLogs({
  action: 'send_email',       // Filter by action
  status: 'approved',         // Filter by status
  eventType: 'approved',      // Filter by event type
  actor: 'dashboard:admin',   // Filter by actor
  from: '2024-01-01',         // Start date (ISO format)
  to: '2024-01-31',           // End date (ISO format)
  requestId: 'req_123',       // Filter by request ID
  limit: 50,                  // Max results (default: 50)
  offset: 0,                  // Pagination offset
})

console.log(audit.entries)     // AuditEntry[]
console.log(audit.pagination)  // { total, limit, offset, hasMore }
```

**Returns:** `Promise<AuditListResult>`

#### `getAuditActors()`

Get a list of unique actor values from audit logs (useful for filter dropdowns).

```typescript
const actors = await client.getAuditActors()
// e.g. ['dashboard:admin', 'discord:12345', 'mcp:user', 'policy:auto']
```

**Returns:** `Promise<string[]>`

---

### API Key Methods

#### `listApiKeys()`

List all API keys (secrets are never returned).

```typescript
const keys = await client.listApiKeys()
```

**Returns:** `Promise<ApiKey[]>`

#### `createApiKey(options)`

Create a new API key. The `key` value is only returned once — save it immediately.

```typescript
const newKey = await client.createApiKey({
  name: 'CI Pipeline',
  scopes: ['request:create', 'request:read'],
  rateLimit: 120,  // Optional: requests per minute
})
console.log('Save this key:', newKey.key)
```

**Returns:** `Promise<ApiKeyCreateResult>`

#### `revokeApiKey(id)`

Revoke an API key by ID.

```typescript
await client.revokeApiKey('key_123')
```

**Returns:** `Promise<void>`

---

## Best Practices

1. **Always set an API key** in production for authentication
2. **Use meaningful action names** that describe what's being approved
3. **Include context** to help humans make informed decisions
4. **Set appropriate urgency levels** to route requests correctly
5. **Log execution results** to maintain a complete audit trail
