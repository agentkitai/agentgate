# @agentkitai/agentgate-core

## 0.1.0

### Minor Changes

- e74f7b7: 9-feature product roadmap implementation.
  - Policy templates with 5 prebuilt templates
  - Pending request triage queue with SLA timers and bulk actions
  - Enterprise SSO enforcement and group-to-role mapping
  - Approval analytics dashboard with KPI charts
  - Escalation policies with background scanner
  - Policy simulation and dry-run mode
  - Channel failover with circuit breaker
  - Webhook reliability observability panel
  - Mobile PWA with installable app experience

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
