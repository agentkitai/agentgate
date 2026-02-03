---
layout: home

hero:
  name: AgentGate
  text: Human-in-the-loop approvals for AI agents
  tagline: A standardized way for AI agents to request and receive human approvals for sensitive actions.
  image:
    src: /logo.svg
    alt: AgentGate
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/your-org/agentgate

features:
  - icon: 🛡️
    title: Policy Engine
    details: Auto-approve, auto-deny, or route to humans based on configurable rules.
  - icon: 👥
    title: Human Approvals
    details: Approve requests via Slack, Discord, email, or the web dashboard.
  - icon: 📊
    title: Real-time Dashboard
    details: Monitor and manage all approval requests in one place.
  - icon: 📝
    title: Audit Logging
    details: Complete history of all requests and decisions for compliance.
  - icon: 🔌
    title: TypeScript SDK
    details: Easy integration for AI agents with full type safety.
  - icon: ⚡
    title: Fast & Lightweight
    details: Hono server with SQLite or PostgreSQL storage.
---

## Quick Example

```typescript
import { AgentGateClient } from '@agentgate/sdk'

const client = new AgentGateClient({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.AGENTGATE_API_KEY,
})

// Request approval for a sensitive action
const request = await client.request({
  action: 'send_email',
  params: { to: 'customer@example.com', subject: 'Order shipped!' },
  urgency: 'normal',
})

// Wait for human decision
const decided = await client.waitForDecision(request.id)

if (decided.status === 'approved') {
  await sendEmail(decided.params)
  await client.confirm(decided.id)
}
```
