# Policy Rules & Matcher Syntax

AgentGate uses a policy engine to automatically evaluate approval requests against configurable rules. Policies let you auto-approve safe actions, auto-deny dangerous ones, and route everything else to the right humans or agents.

## Policy Structure

A policy is a named, prioritized collection of rules:

```json
{
  "id": "policy-001",
  "name": "Production Safety",
  "priority": 10,
  "enabled": true,
  "rules": [
    {
      "match": { "action": "read_file" },
      "decision": "auto_approve"
    }
  ]
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier |
| `name` | `string` | Human-readable name |
| `priority` | `number` | **Lower number = higher priority** (evaluated first) |
| `enabled` | `boolean` | Only enabled policies are evaluated. Set to `false` to disable a policy without deleting it |
| `rules` | `PolicyRule[]` | Rules evaluated in order; first match wins |

### Priority Ordering

Policies are sorted by `priority` in ascending order before evaluation. A policy with `priority: 1` is evaluated before `priority: 100`. Within a policy, rules are evaluated in array order. The **first matching rule across all policies** determines the decision.

If no rule matches any policy, the default decision is `route_to_human` (safe fallback).

### Enabled Flag

Set `enabled: false` to temporarily deactivate a policy. Disabled policies are completely skipped during evaluation — they won't match any requests. This is useful for:
- Testing new policies before activating them
- Temporarily disabling a policy during incidents
- Keeping seasonal or conditional policies ready to toggle on

## Rule Structure

Each rule has a `match` object and a `decision`:

```json
{
  "match": {
    "action": "send_email",
    "context.user.role": "admin"
  },
  "decision": "auto_approve",
  "approvers": ["ops-team"],
  "channels": ["#approvals"]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `match` | `Record<string, MatcherValue>` | All matchers must match (AND logic) |
| `decision` | `string` | One of: `auto_approve`, `auto_deny`, `route_to_human`, `route_to_agent` |
| `approvers` | `string[]` | *(optional)* Who to route to |
| `channels` | `string[]` | *(optional)* Notification channels (e.g., Slack channels) |
| `requireReason` | `boolean` | *(optional)* Require a reason for the decision |

## Matcher Types

The `match` object maps field paths to matcher values. **All matchers in a rule must match** for the rule to apply (AND logic).

### Exact Match

Match a field against an exact string, number, or boolean value.

```json
{ "match": { "action": "send_email" } }
{ "match": { "urgency": "critical" } }
{ "match": { "params.amount": 100 } }
{ "match": { "context.verified": true } }
```

### `$lt` — Less Than

```json
{ "match": { "params.amount": { "$lt": 1000 } } }
```

Matches when the field value is a number strictly less than the given value.

### `$gt` — Greater Than

```json
{ "match": { "params.amount": { "$gt": 0 } } }
```

Matches when the field value is a number strictly greater than the given value.

### `$lte` — Less Than or Equal

```json
{ "match": { "params.amount": { "$lte": 500 } } }
```

### `$gte` — Greater Than or Equal

```json
{ "match": { "params.amount": { "$gte": 100 } } }
```

### `$in` — Value in Array

```json
{ "match": { "action": { "$in": ["read_file", "list_files", "get_status"] } } }
```

Matches when the field value is one of the values in the array. Array items can be strings or numbers.

### `$regex` — Regular Expression

```json
{ "match": { "params.path": { "$regex": "^/safe/.*\\.txt$" } } }
```

Matches when the field value (must be a string) matches the regular expression. Unsafe regex patterns (potential ReDoS) are automatically rejected and treated as non-matches.

## Nested Dot-Notation Paths

Matcher keys support dot-notation to access nested fields in the request object. The request data available for matching includes:

- `action` — the action name (top-level)
- `status` — current request status
- `urgency` — urgency level
- `params.*` — action parameters (also available at top level)
- `context.*` — contextual information

> **⚠️ Warning: Parameter Key Collisions**
>
> Keys in `request.params` are flattened into the top-level match namespace. If your `params` object contains keys named `action`, `status`, or `urgency`, they will **shadow** the top-level request fields of the same name, making it impossible to match on the actual request action, status, or urgency. Avoid using parameter keys that collide with top-level field names (`action`, `status`, `urgency`).

**Examples:**

```json
{ "match": { "context.user.role": "admin" } }
{ "match": { "context.environment": "production" } }
{ "match": { "params.recipient.domain": "internal.com" } }
```

Given a request with `context: { user: { role: "admin", department: "engineering" } }`, the path `context.user.role` resolves to `"admin"`.

## Real-World Policy Examples

### Example 1: Auto-Approve Read-Only Operations

```json
{
  "name": "Allow Read-Only",
  "priority": 10,
  "enabled": true,
  "rules": [
    {
      "match": {
        "action": { "$in": ["read_file", "list_files", "get_status", "search"] }
      },
      "decision": "auto_approve"
    }
  ]
}
```

### Example 2: Block High-Value Transfers

```json
{
  "name": "Transfer Limits",
  "priority": 5,
  "enabled": true,
  "rules": [
    {
      "match": {
        "action": "transfer_funds",
        "params.amount": { "$gte": 10000 }
      },
      "decision": "auto_deny"
    },
    {
      "match": {
        "action": "transfer_funds",
        "params.amount": { "$lt": 100 }
      },
      "decision": "auto_approve"
    },
    {
      "match": {
        "action": "transfer_funds"
      },
      "decision": "route_to_human",
      "approvers": ["finance-team"],
      "channels": ["#finance-approvals"]
    }
  ]
}
```

This policy evaluates transfers in order: deny ≥$10k, auto-approve <$100, route everything in between to the finance team.

### Example 3: Admin Bypass

```json
{
  "name": "Admin Auto-Approve",
  "priority": 1,
  "enabled": true,
  "rules": [
    {
      "match": {
        "context.user.role": "admin"
      },
      "decision": "auto_approve"
    }
  ]
}
```

With `priority: 1`, this is evaluated before other policies. All requests from admin users are auto-approved.

### Example 4: Production Environment Safeguard

```json
{
  "name": "Production Guard",
  "priority": 3,
  "enabled": true,
  "rules": [
    {
      "match": {
        "context.environment": "production",
        "action": { "$regex": "^(delete|drop|truncate)" }
      },
      "decision": "route_to_human",
      "approvers": ["sre-oncall"],
      "channels": ["#prod-approvals"],
      "requireReason": true
    }
  ]
}
```

Destructive actions in production are routed to the SRE on-call with a required reason.

### Example 5: Rate-Limited Email Sending

```json
{
  "name": "Email Policy",
  "priority": 20,
  "enabled": true,
  "rules": [
    {
      "match": {
        "action": "send_email",
        "params.recipientCount": { "$gt": 50 }
      },
      "decision": "route_to_human",
      "approvers": ["comms-team"]
    },
    {
      "match": {
        "action": "send_email",
        "params.to": { "$regex": "\\.(gov|mil)$" }
      },
      "decision": "route_to_human",
      "requireReason": true
    },
    {
      "match": {
        "action": "send_email",
        "context.user.role": { "$in": ["admin", "marketing"] }
      },
      "decision": "auto_approve"
    }
  ]
}
```

Bulk emails (>50 recipients) require approval. Emails to government/military domains require human review with a reason. Admin and marketing users can send other emails freely.

## Managing Policies via API

Create and manage policies through the REST API. See the [API Reference](./api.md) for full details.

### Create a Policy

```
POST /api/policies
Content-Type: application/json

{
  "name": "My Policy",
  "priority": 50,
  "enabled": true,
  "rules": [
    {
      "match": { "action": "deploy" },
      "decision": "route_to_human",
      "approvers": ["devops"]
    }
  ]
}
```

### List Policies

```
GET /api/policies
```

### Update a Policy

```
PUT /api/policies/:id
```

### Delete a Policy

```
DELETE /api/policies/:id
```

## Evaluation Flow

```
Request arrives
  → Filter policies where enabled = true
  → Sort by priority (ascending — lower number first)
  → For each policy, evaluate rules in array order
  → First matching rule → return its decision
  → No match across all policies → default to route_to_human
```

This means:
1. A `priority: 1` policy always beats a `priority: 100` policy
2. Within a policy, rule order matters — put specific rules before general ones
3. The system is safe by default — unmatched requests go to humans
