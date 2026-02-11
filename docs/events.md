# Event System and Notification Dispatcher

AgentGate includes a built-in event system for observing system activity and a notification dispatcher for routing events to external channels (email, Slack, Discord, webhooks, or custom adapters).

## AgentGateEmitter and Event Types

All significant actions in AgentGate emit typed events. Event names are defined as constants in `@agentgate/core`:

```typescript
import { EventNames } from "@agentgate/core";
```

### Event Name Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `REQUEST_CREATED` | `request.created` | New approval request created |
| `REQUEST_UPDATED` | `request.updated` | Request metadata or status changed |
| `REQUEST_DECIDED` | `request.decided` | Request approved or denied |
| `REQUEST_EXPIRED` | `request.expired` | Request expired without a decision |
| `REQUEST_ESCALATED` | `request.escalated` | Request escalated to another approver/channel |
| `POLICY_CREATED` | `policy.created` | New policy created |
| `POLICY_UPDATED` | `policy.updated` | Policy updated |
| `POLICY_DELETED` | `policy.deleted` | Policy deleted |
| `POLICY_MATCHED` | `policy.matched` | Policy rule matched a request |
| `WEBHOOK_TRIGGERED` | `webhook.triggered` | Webhook delivery attempted |
| `WEBHOOK_FAILED` | `webhook.failed` | Webhook delivery failed |
| `WEBHOOK_RETRY` | `webhook.retry` | Webhook delivery retried |
| `API_KEY_CREATED` | `api_key.created` | API key created |
| `API_KEY_REVOKED` | `api_key.revoked` | API key revoked |
| `API_KEY_RATE_LIMITED` | `api_key.rate_limited` | API key hit rate limit |
| `SYSTEM_STARTUP` | `system.startup` | Server started |
| `SYSTEM_SHUTDOWN` | `system.shutdown` | Server shutting down |
| `SYSTEM_ERROR` | `system.error` | System-level error |

> **Note:** Of the 18 event types above, only 9 have additional payload fields (documented below). The remaining 9 events carry only the `BaseEvent` fields with no extra payload:
>
> - `policy.created`, `policy.updated`, `policy.deleted` — Policy CRUD operations
> - `webhook.retry` — Webhook retry attempt
> - `api_key.created`, `api_key.revoked` — API key lifecycle
> - `system.startup`, `system.shutdown`, `system.error` — System lifecycle
>
> For these events, use the `BaseEvent` fields (`type`, `timestamp`, `eventId`, `source`, `metadata`) to identify and handle them.

### Base Event Interface

Every event extends `BaseEvent`:

```typescript
interface BaseEvent<T extends EventName> {
  type: T;                              // Event type identifier
  timestamp: number;                    // Unix timestamp (ms)
  eventId: string;                      // Unique ID (e.g., "evt_1707…_a3f")
  source: string;                       // Origin (default: "agentgate")
  metadata?: Record<string, unknown>;   // Optional extra data
}
```

Use the `createBaseEvent` helper to generate events with pre-filled common fields:

```typescript
import { createBaseEvent } from "@agentgate/core";

const base = createBaseEvent("request.created", "my-plugin");
// → { type: "request.created", timestamp: …, eventId: "evt_…", source: "my-plugin" }
```

---

## Event Payload Types

Each event type carries a typed `payload`. All fields are listed below.

### `request.created`

| Field | Type | Description |
|-------|------|-------------|
| `requestId` | `string` | Unique request identifier |
| `action` | `string` | Action being requested |
| `params` | `Record<string, unknown>` | Action parameters |
| `context` | `Record<string, unknown>` | Caller context |
| `urgency` | `ApprovalUrgency` | `"low"` \| `"normal"` \| `"high"` \| `"critical"` |
| `expiresAt` | `string?` | ISO timestamp when the request expires |
| `policyDecision` | `object?` | If a policy matched: `{ decision, policyId?, ruleName? }` |

### `request.updated`

| Field | Type | Description |
|-------|------|-------------|
| `requestId` | `string` | Request identifier |
| `changes` | `Array<{ field, oldValue, newValue }>` | Changed fields |

### `request.decided`

| Field | Type | Description |
|-------|------|-------------|
| `requestId` | `string` | Request identifier |
| `action` | `string` | The action that was decided on |
| `status` | `"approved"` \| `"denied"` | Decision |
| `decidedBy` | `string` | Who made the decision |
| `decidedByType` | `"human"` \| `"agent"` \| `"policy"` | Decider type |
| `reason` | `string?` | Optional reason |
| `decisionTimeMs` | `number` | Time from creation to decision (ms) |

### `request.expired`

| Field | Type | Description |
|-------|------|-------------|
| `requestId` | `string` | Request identifier |
| `action` | `string` | The action |
| `urgency` | `ApprovalUrgency` | Urgency level |
| `pendingTimeMs` | `number` | How long the request was pending (ms) |

### `request.escalated`

| Field | Type | Description |
|-------|------|-------------|
| `requestId` | `string` | Request identifier |
| `action` | `string` | The action |
| `fromApprover` | `string?` | Previous approver |
| `toApprover` | `string?` | New approver |
| `fromChannel` | `string?` | Previous channel |
| `toChannel` | `string?` | New channel |
| `reason` | `string?` | Escalation reason |

### `policy.matched`

| Field | Type | Description |
|-------|------|-------------|
| `requestId` | `string` | Request that matched |
| `policyId` | `string` | Policy ID |
| `policyName` | `string` | Policy name |
| `decision` | `DecisionType` | Auto-decision applied |
| `matchedRule` | `{ index, match }` | Rule index and match criteria |

### `webhook.triggered`

| Field | Type | Description |
|-------|------|-------------|
| `webhookId` | `string` | Webhook ID |
| `url` | `string` | Delivery URL |
| `triggerEvent` | `EventName` | Event that triggered it |
| `requestId` | `string?` | Associated request |
| `statusCode` | `number?` | HTTP response code |
| `responseTimeMs` | `number?` | Response time |

### `webhook.failed`

| Field | Type | Description |
|-------|------|-------------|
| `webhookId` | `string` | Webhook ID |
| `url` | `string` | Delivery URL |
| `triggerEvent` | `EventName` | Event that triggered it |
| `error` | `string` | Error message |
| `attempt` | `number` | Attempt number |
| `willRetry` | `boolean` | Whether a retry is scheduled |

### `api_key.rate_limited`

| Field | Type | Description |
|-------|------|-------------|
| `apiKeyId` | `string` | API key ID |
| `endpoint` | `string` | Rate-limited endpoint |
| `requestsInWindow` | `number` | Requests made in the current window |
| `limitPerMinute` | `number` | Configured limit |

---

## Event Filtering

The `eventMatchesFilter` function checks whether an event matches a filter:

```typescript
import { eventMatchesFilter } from "@agentgate/core";

const match = eventMatchesFilter(event, {
  types: ["request.created", "request.decided"],  // Match these event types
  actions: ["deploy", "delete"],                   // Match these actions (request events only)
  urgencies: ["high", "critical"],                 // Match these urgencies (request events only)
});
```

All filter fields are optional. An empty/omitted filter matches all events. Multiple fields are ANDed together — the event must satisfy all specified criteria.

This function is used internally by the notification dispatcher to match channel routes.

---

## NotificationDispatcher Architecture

The `NotificationDispatcher` routes events to notification channels through a three-tier matching strategy:

```
Event → Dispatcher
           ├─ 1. Policy channels (from matched policy rule)
           ├─ 2. Configured channel routes (config + options)
           └─ 3. Default channels (fallback if nothing else matches)
```

### How It Works

1. **Policy channels** — If a policy rule specifies notification channels (format: `"type:target"`, e.g., `"slack:#alerts"`), those are used first.
2. **Channel routes** — Routes defined in config (`channelRoutes`) or passed as `defaultRoutes` in `DispatcherOptions`. Each route can filter by event type, action, and urgency. Only enabled routes that match the event are selected.
3. **Default channels** — If no routes matched at all, falls back to default Slack/Discord channels from config (`slackDefaultChannel`, `discordDefaultChannel`).

Results are deduplicated by `channel:target` to avoid duplicate notifications.

### Usage

```typescript
import { createDispatcher, getGlobalDispatcher } from "@agentgate/server";

// Use the singleton
const dispatcher = getGlobalDispatcher();

// Or create a custom instance
const dispatcher = createDispatcher({
  failSilently: true,           // Don't throw on delivery errors (default: true)
  logLevel: "info",             // Log level for delivery messages
  defaultRoutes: [              // Fallback routes
    { channel: "slack", target: "#general", enabled: true },
  ],
});

// Dispatch an event
const results = await dispatcher.dispatch(event, ["slack:#alerts"]);

// Fire-and-forget
dispatcher.dispatchSync(event);
```

### DispatcherOptions

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `defaultRoutes` | `ChannelRoute[]` | `[]` | Routes used when policy doesn't specify channels |
| `failSilently` | `boolean` | `true` | Swallow delivery errors instead of throwing |
| `logLevel` | `string` | `"info"` | Controls dispatch logging. When set to `"error"`, **all** non-error log messages are suppressed (delivery success, routing info, etc.). Any other value (e.g., `"info"`, `"debug"`) enables normal logging. Note: this is a simple on/off toggle around errors, not a full log-level hierarchy. |

### ChannelRoute

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string?` | Optional route identifier |
| `channel` | `NotificationChannelType` | `"email"` \| `"slack"` \| `"discord"` \| `"webhook"` |
| `target` | `string` | Target (email address, channel ID, webhook URL) |
| `eventTypes` | `string[]?` | Only route these event types |
| `actions` | `string[]?` | Only route events with these actions |
| `urgencies` | `ApprovalUrgency[]?` | Only route events with these urgency levels |
| `enabled` | `boolean?` | Whether this route is active |

---

## Channel Adapter Interface

Every notification channel implements the `NotificationChannelAdapter` interface:

```typescript
interface NotificationChannelAdapter {
  /** Channel type identifier */
  readonly type: NotificationChannelType;

  /** Send a notification for an event */
  send(target: string, event: AgentGateEvent): Promise<NotificationResult>;

  /** Check if the adapter is properly configured */
  isConfigured(): boolean;
}
```

### NotificationResult

```typescript
interface NotificationResult {
  success: boolean;
  channel: NotificationChannelType;
  target: string;
  error?: string;
  timestamp: number;
  response?: unknown;
}
```

### Built-in Adapters

| Adapter | Type | Target Format | Configuration Required |
|---------|------|---------------|----------------------|
| `EmailAdapter` | `"email"` | Email address | `SMTP_HOST`, `SMTP_FROM` |
| `SlackAdapter` | `"slack"` | Channel ID or name | `SLACK_BOT_TOKEN` |
| `DiscordAdapter` | `"discord"` | Channel ID or webhook URL | `DISCORD_BOT_TOKEN` (or webhook URL as target) |
| `WebhookAdapter` | `"webhook"` | HTTP(S) URL | None (always configured) |

Each adapter formats events appropriately for its platform — email uses HTML templates with action buttons, Slack uses Block Kit, Discord uses embeds, and webhooks send structured JSON with HMAC signatures.

---

## Building a Custom Adapter

Here's a complete example of building an SMS adapter using Twilio:

```typescript
// adapters/sms.ts
import type { AgentGateEvent } from "@agentgate/core";
import type {
  NotificationChannelAdapter,
  NotificationChannelType,
  NotificationResult,
} from "@agentgate/server/lib/notification/types";

export class SmsAdapter implements NotificationChannelAdapter {
  // The type must be a valid NotificationChannelType.
  // To add a new type, extend the NotificationChannelType union in your project
  // or cast as needed.
  // ⚠️ "sms" is NOT part of the built-in NotificationChannelType union
  // ("email" | "slack" | "discord" | "webhook"). The `as` cast is required.
  // See the warning below about limitations of custom channel types.
  readonly type = "sms" as NotificationChannelType;

  private accountSid: string;
  private authToken: string;
  private fromNumber: string;

  constructor(options: { accountSid: string; authToken: string; fromNumber: string }) {
    this.accountSid = options.accountSid;
    this.authToken = options.authToken;
    this.fromNumber = options.fromNumber;
  }

  isConfigured(): boolean {
    return Boolean(this.accountSid && this.authToken && this.fromNumber);
  }

  async send(target: string, event: AgentGateEvent): Promise<NotificationResult> {
    const timestamp = Date.now();

    if (!this.isConfigured()) {
      return {
        success: false,
        channel: this.type,
        target,
        error: "SMS adapter not configured",
        timestamp,
      };
    }

    try {
      // Format a concise SMS message
      const message = this.formatMessage(event);

      // Call Twilio API
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
      const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: target,        // e.g., "+15551234567"
          From: this.fromNumber,
          Body: message,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          channel: this.type,
          target,
          error: `Twilio API error: ${response.status} - ${error.slice(0, 200)}`,
          timestamp,
        };
      }

      const result = (await response.json()) as { sid: string };

      return {
        success: true,
        channel: this.type,
        target,
        timestamp,
        response: { messageSid: result.sid },
      };
    } catch (error) {
      return {
        success: false,
        channel: this.type,
        target,
        error: error instanceof Error ? error.message : "Unknown SMS error",
        timestamp,
      };
    }
  }

  private formatMessage(event: AgentGateEvent): string {
    switch (event.type) {
      case "request.created":
        return `[AgentGate] Approval needed: ${event.payload.action} (${event.payload.urgency})`;
      case "request.decided":
        return `[AgentGate] ${event.payload.action} ${event.payload.status} by ${event.payload.decidedBy}`;
      case "request.expired":
        return `[AgentGate] Request expired: ${event.payload.action}`;
      default:
        return `[AgentGate] ${event.type}`;
    }
  }
}
```

> **⚠️ Warning: Custom Channel Type Limitations**
>
> `NotificationChannelType` is a **closed union** type: `"email" | "slack" | "discord" | "webhook"`. Custom channel types like `"sms"` are **not** part of this union, which is why the example uses `as NotificationChannelType` to cast the value.
>
> Be aware of the following limitations:
>
> 1. **The `as` cast bypasses type safety** — TypeScript won't catch typos or mismatches in your custom type string.
> 2. **Config-based channel routes won't accept custom types** — The `NotificationChannelSchema` in config validation only allows the four built-in types. If you want to use custom channels in config-based `channelRoutes`, you must also extend the `NotificationChannelSchema` Zod schema.
> 3. **Policy channel strings** (e.g., `"sms:+15551234567"`) work at runtime because they're parsed as plain strings, but they won't pass config validation if routed through the config system.
>
> For full type safety, consider forking the `NotificationChannelType` and `NotificationChannelSchema` definitions in your project to include your custom types.

## Registering a Custom Adapter

Register your adapter with the dispatcher:

```typescript
import { getGlobalDispatcher, createDispatcher } from "@agentgate/server";
import { SmsAdapter } from "./adapters/sms";

// Option 1: Register on the global singleton
const dispatcher = getGlobalDispatcher();
dispatcher.registerAdapter(
  new SmsAdapter({
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
    authToken: process.env.TWILIO_AUTH_TOKEN!,
    fromNumber: process.env.TWILIO_FROM_NUMBER!,
  })
);

// Option 2: Create a custom dispatcher with the adapter
const dispatcher = createDispatcher({ failSilently: true });
dispatcher.registerAdapter(new SmsAdapter({ /* ... */ }));

// Now you can use it in channel routes and policy channels:
// Route config: { channel: "sms", target: "+15551234567", eventTypes: ["request.created"] }
// Policy channel: "sms:+15551234567"
```

You can also verify registration:

```typescript
const adapter = dispatcher.getAdapter("sms" as NotificationChannelType);
console.log(adapter?.isConfigured()); // true

console.log(dispatcher.isChannelConfigured("sms" as NotificationChannelType)); // true
```

---

## Source Files

- Event types and filtering: [`packages/core/src/events.ts`](../packages/core/src/events.ts)
- Notification types: [`packages/server/src/lib/notification/types.ts`](../packages/server/src/lib/notification/types.ts)
- Dispatcher: [`packages/server/src/lib/notification/dispatcher.ts`](../packages/server/src/lib/notification/dispatcher.ts)
- Adapters: [`packages/server/src/lib/notification/adapters/`](../packages/server/src/lib/notification/adapters/)
