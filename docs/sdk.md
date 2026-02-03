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
  
  // Confirm execution for audit trail
  await client.confirm(request.id, { sent: true })
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

#### `confirm(id, result?)`

Confirm that an action was executed. Used for audit trail.

```typescript
await client.confirm('req_123', { 
  executed: true, 
  timestamp: new Date() 
})
```

**Returns:** `Promise<void>`

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

## Best Practices

1. **Always set an API key** in production for authentication
2. **Use meaningful action names** that describe what's being approved
3. **Include context** to help humans make informed decisions
4. **Set appropriate urgency levels** to route requests correctly
5. **Confirm execution** to maintain a complete audit trail
