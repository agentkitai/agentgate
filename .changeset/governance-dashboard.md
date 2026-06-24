---
"@agentgate/dashboard": minor
"@agentgate/server": minor
---

Add a per-agent governance dashboard (#22).

- **New Agents page** (`/agents`, `keys:manage`) — register/revoke agents and, per agent: set/clear the monthly budget with a live budget-vs-spend bar (current-month spend from AgentLens, gracefully shows "n/a" when spend telemetry isn't configured), the bound virtual keys, and the active tool overrides (add/remove `require_approval` / `deny` overrides with an optional TTL).
- **Policies** — each policy now shows its `scope` (global / per_agent / per_tool) and the agent/tool ids it targets, plus a **"Clone to agents"** action that creates a per-agent-scoped copy across selected agents.
- **Audit log** — new filters for **`verifiedAgentId`** (the cryptographically verified agent that made the request) and **`decidedByType`** (policy / human / agent / budget_limiter / override), surfaced inline in each entry. Server-side: `GET /api/audit` accepts `verifiedAgentId` (column filter via the request join) and `decidedByType` (matched in the decision event's details JSON, backend-agnostic via the active dialect).

No new backend endpoints beyond the two audit filters — the dashboard composes the existing agents / api-keys / overrides / policies APIs.
