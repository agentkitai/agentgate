---
"@agentgate/core": patch
"@agentgate/sdk": patch
"@agentgate/cli": patch
---

Security, performance, UI/UX, and code quality improvements from 30-idea audit.

- HSTS auto-enables in production
- Docker production network isolation with Redis auth
- Auth middleware uses cached API key validation
- Webhook delivery logs failed promises
- Dashboard pages use skeleton loading screens
- RequestList migrated to ResponsiveTable component
- AgentGateEmitter API documented in events.md
