# REST API Reference

AgentGate exposes a RESTful API for managing approval requests, policies, and integrations.

## Authentication

All endpoints (except `/health`) require authentication via API key.

```bash
curl -H "Authorization: Bearer agk_your_api_key" \
  http://localhost:3000/api/requests
```

### API Key Scopes

| Scope | Description |
|-------|-------------|
| `admin` | Full access to all operations |
| `request:create` | Create new approval requests |
| `request:read` | Read approval requests |
| `request:decide` | Approve or deny requests |
| `webhook:manage` | Create/update/delete webhooks |

## Rate Limiting

Rate limits are enforced per API key using a sliding window algorithm.

**Response Headers:**
| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests per minute |
| `X-RateLimit-Remaining` | Remaining requests in window |
| `X-RateLimit-Reset` | Seconds until window resets |

When exceeded, returns `429 Too Many Requests`.

## Endpoints

### Health Check

```http
GET /health
```

Returns server health status. No authentication required.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

### Create Request

```http
POST /api/requests
```

**Required Scope:** `request:create`

**Body:**
```json
{
  "action": "send_email",
  "params": {
    "to": "customer@example.com",
    "subject": "Order shipped"
  },
  "context": {
    "orderId": "12345"
  },
  "urgency": "normal",
  "expiresAt": "2024-01-15T11:30:00Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | Yes | Action identifier |
| `params` | object | No | Action parameters |
| `context` | object | No | Additional context |
| `urgency` | string | No | `low`, `normal`, `high`, `critical` |
| `expiresAt` | string | No | ISO 8601 expiration time |

**Response:** `201 Created`
```json
{
  "id": "req_abc123",
  "action": "send_email",
  "params": { "to": "customer@example.com" },
  "status": "pending",
  "urgency": "normal",
  "createdAt": "2024-01-15T10:30:00Z",
  "expiresAt": "2024-01-15T11:30:00Z"
}
```

---

### List Requests

```http
GET /api/requests
```

**Required Scope:** `request:read`

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status |
| `action` | string | Filter by action |
| `urgency` | string | Filter by urgency |
| `limit` | number | Max results (default: 50) |
| `offset` | number | Pagination offset |

**Response:** `200 OK`
```json
[
  {
    "id": "req_abc123",
    "action": "send_email",
    "status": "pending",
    "urgency": "normal",
    "createdAt": "2024-01-15T10:30:00Z"
  }
]
```

---

### Get Request

```http
GET /api/requests/:id
```

**Required Scope:** `request:read`

**Response:** `200 OK`
```json
{
  "id": "req_abc123",
  "action": "send_email",
  "params": { "to": "customer@example.com" },
  "context": { "orderId": "12345" },
  "status": "approved",
  "urgency": "normal",
  "decidedBy": "admin@example.com",
  "decisionReason": "Looks good",
  "createdAt": "2024-01-15T10:30:00Z",
  "decidedAt": "2024-01-15T10:35:00Z"
}
```

---

### Decide Request

```http
POST /api/requests/:id/decide
```

**Required Scope:** `request:decide`

**Body:**
```json
{
  "decision": "approved",
  "reason": "Verified by security team"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `decision` | string | Yes | `approved` or `denied` |
| `reason` | string | No | Reason for decision |

**Response:** `200 OK`
```json
{
  "id": "req_abc123",
  "status": "approved",
  "decidedBy": "api_key_name",
  "decidedAt": "2024-01-15T10:35:00Z"
}
```

---

### Confirm Execution

```http
POST /api/requests/:id/confirm
```

**Required Scope:** `request:create`

Confirm that an approved action was executed (for audit trail).

**Body:**
```json
{
  "result": {
    "success": true,
    "messageId": "msg_xyz"
  }
}
```

**Response:** `200 OK`

---

### Get Audit Trail

```http
GET /api/requests/:id/audit
```

**Required Scope:** `request:read`

**Response:** `200 OK`
```json
[
  {
    "timestamp": "2024-01-15T10:30:00Z",
    "event": "created",
    "actor": "api_key_name"
  },
  {
    "timestamp": "2024-01-15T10:35:00Z",
    "event": "approved",
    "actor": "admin@example.com",
    "details": { "reason": "Looks good" }
  },
  {
    "timestamp": "2024-01-15T10:36:00Z",
    "event": "confirmed",
    "actor": "api_key_name",
    "details": { "success": true }
  }
]
```

---

### List Policies

```http
GET /api/policies
```

**Required Scope:** `admin`

**Response:** `200 OK`
```json
[
  {
    "id": "pol_123",
    "name": "auto-approve-emails",
    "priority": 10,
    "enabled": true,
    "rules": [...]
  }
]
```

---

### Create Policy

```http
POST /api/policies
```

**Required Scope:** `admin`

**Body:**
```json
{
  "name": "auto-approve-low-risk",
  "priority": 10,
  "enabled": true,
  "rules": [
    {
      "match": { "action": "send_notification" },
      "decision": "auto_approve"
    }
  ]
}
```

---

### API Keys

#### Create API Key

```http
POST /api/keys
```

**Required Scope:** `admin`

**Body:**
```json
{
  "name": "My Agent",
  "scopes": ["request:create", "request:read"],
  "rateLimit": 60
}
```

**Response:** `201 Created`
```json
{
  "id": "key_abc123",
  "key": "agk_...",  // Only shown once!
  "name": "My Agent",
  "scopes": ["request:create", "request:read"],
  "rateLimit": 60
}
```

#### List API Keys

```http
GET /api/keys
```

**Required Scope:** `admin`

#### Revoke API Key

```http
DELETE /api/keys/:id
```

**Required Scope:** `admin`

---

### Webhooks

#### List Webhooks

```http
GET /api/webhooks
```

**Required Scope:** `webhook:manage`

#### Create Webhook

```http
POST /api/webhooks
```

**Required Scope:** `webhook:manage`

**Body:**
```json
{
  "url": "https://example.com/webhook",
  "events": ["request.created", "request.decided"],
  "secret": "optional-signing-secret"
}
```

#### Delete Webhook

```http
DELETE /api/webhooks/:id
```

**Required Scope:** `webhook:manage`

---

## Error Responses

All errors follow this format:

```json
{
  "error": {
    "code": "not_found",
    "message": "Request not found"
  }
}
```

| Status | Code | Description |
|--------|------|-------------|
| 400 | `bad_request` | Invalid request body |
| 401 | `unauthorized` | Missing or invalid API key |
| 403 | `forbidden` | Insufficient permissions |
| 404 | `not_found` | Resource not found |
| 409 | `conflict` | Request already decided |
| 429 | `rate_limited` | Rate limit exceeded |
| 500 | `internal_error` | Server error |
