# @agentgate/sdk

## 0.0.2

### Patch Changes

- 618e2da: Security, performance, UI/UX, and code quality improvements from 30-idea audit.
  - HSTS auto-enables in production
  - Docker production network isolation with Redis auth
  - Auth middleware uses cached API key validation
  - Webhook delivery logs failed promises
  - Dashboard pages use skeleton loading screens
  - RequestList migrated to ResponsiveTable component
  - AgentGateEmitter API documented in events.md

- Updated dependencies [618e2da]
  - @agentgate/core@0.0.2
