# Webhooks

AgentGate can notify external systems when request events occur via webhooks.

## Features

- 🔔 Real-time event notifications
- 🔐 HMAC-SHA256 signature verification
- 🔄 Automatic retries with exponential backoff
- 📋 Comprehensive event types

## Creating Webhooks

### Via API

```bash
curl -X POST http://localhost:3000/api/webhooks \
  -H "Authorization: Bearer $AGENTGATE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-server.com/webhook",
    "events": ["request.created", "request.decided"],
    "secret": "your-signing-secret"
  }'
```

### Via Dashboard

1. Open the AgentGate dashboard
2. Navigate to **Settings → Webhooks**
3. Click **Add Webhook**
4. Enter URL, select events, and optionally set a secret

## Webhook Events

| Event | Description |
|-------|-------------|
| `request.created` | A new approval request was created |
| `request.decided` | A request was approved or denied |
| `request.expired` | A request expired without decision |
| `request.confirmed` | Action execution was confirmed |

### Event Payload

All webhooks follow this structure:

```json
{
  "event": "request.decided",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "id": "req_abc123",
    "action": "send_email",
    "status": "approved",
    "params": {
      "to": "customer@example.com"
    },
    "decidedBy": "admin@example.com",
    "decisionReason": "Looks good",
    "createdAt": "2024-01-15T10:25:00Z",
    "decidedAt": "2024-01-15T10:30:00Z"
  }
}
```

## Signature Verification

If you provide a `secret`, requests are signed with HMAC-SHA256.

### Headers

```
X-AgentGate-Signature: sha256=abc123...
X-AgentGate-Timestamp: 1705312200
```

### Verification Example

::: code-group
```typescript [Node.js]
import crypto from 'crypto'

function verifyWebhook(
  payload: string,
  signature: string,
  timestamp: string,
  secret: string
): boolean {
  const signedPayload = `${timestamp}.${payload}`
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex')
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(`sha256=${expectedSignature}`)
  )
}

// Express middleware
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-agentgate-signature'] as string
  const timestamp = req.headers['x-agentgate-timestamp'] as string
  
  if (!verifyWebhook(req.body.toString(), signature, timestamp, SECRET)) {
    return res.status(401).send('Invalid signature')
  }
  
  const event = JSON.parse(req.body.toString())
  // Handle event...
  
  res.status(200).send('OK')
})
```

```python [Python]
import hmac
import hashlib

def verify_webhook(payload: bytes, signature: str, timestamp: str, secret: str) -> bool:
    signed_payload = f"{timestamp}.{payload.decode()}"
    expected = hmac.new(
        secret.encode(),
        signed_payload.encode(),
        hashlib.sha256
    ).hexdigest()
    
    return hmac.compare_digest(signature, f"sha256={expected}")

# Flask example
@app.route('/webhook', methods=['POST'])
def webhook():
    signature = request.headers.get('X-AgentGate-Signature')
    timestamp = request.headers.get('X-AgentGate-Timestamp')
    
    if not verify_webhook(request.data, signature, timestamp, SECRET):
        return 'Invalid signature', 401
    
    event = request.json
    # Handle event...
    
    return 'OK', 200
```
:::

## Retry Behavior

Failed webhook deliveries are retried with exponential backoff:

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 1 minute |
| 3 | 5 minutes |
| 4 | 30 minutes |
| 5 | 2 hours |

After 5 failed attempts, the webhook is marked as failed and no further retries occur.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBHOOK_TIMEOUT_MS` | `5000` | Request timeout in ms |
| `WEBHOOK_MAX_RETRIES` | `3` | Maximum retry attempts |

## Managing Webhooks

### List webhooks

```bash
curl http://localhost:3000/api/webhooks \
  -H "Authorization: Bearer $AGENTGATE_API_KEY"
```

### Delete webhook

```bash
curl -X DELETE http://localhost:3000/api/webhooks/whk_abc123 \
  -H "Authorization: Bearer $AGENTGATE_API_KEY"
```

### Update webhook

```bash
curl -X PATCH http://localhost:3000/api/webhooks/whk_abc123 \
  -H "Authorization: Bearer $AGENTGATE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "events": ["request.created", "request.decided", "request.expired"],
    "enabled": true
  }'
```

## Use Cases

### Audit Logging

Send all events to your logging system:

```json
{
  "url": "https://logs.example.com/agentgate",
  "events": ["request.created", "request.decided", "request.expired"],
  "secret": "audit-secret"
}
```

### Workflow Automation

Trigger actions when requests are approved:

```javascript
// n8n, Zapier, or custom webhook handler
app.post('/webhook', (req, res) => {
  const { event, data } = req.body
  
  if (event === 'request.decided' && data.status === 'approved') {
    // Trigger downstream automation
    executeApprovedAction(data)
  }
  
  res.sendStatus(200)
})
```

### Slack/Discord Notifications

While AgentGate has built-in Slack/Discord support, you can also use webhooks with services like Zapier to create custom notification flows.
