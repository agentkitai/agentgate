# Per-Agent Governance

AgentGate is more than an approval queue — it's a governance plane for the AI
agents calling your tools. Every agent gets a **verifiable identity**, and you
attach **budgets**, **policies**, and **tool guardrails** to that identity. This
page is the end-to-end picture; the deeper references are linked inline.

## The model in one paragraph

An **agent** is a registered principal with a cryptographic credential. It
authenticates per request (an `X-Agent-Token`, or an agent-bound API key), and
AgentGate resolves a **verified agent id** before making any decision. Budgets,
policies, and overrides are all keyed on that verified id — never on a
self-reported value — so a misconfigured or malicious caller can't impersonate
another agent. Every approval request and audit row records the verified id.

## 1. Agent identity

Register an agent and mint credentials:

```bash
# Register an agent — returns its id (agt_…) + client secret (ags_…)
curl -X POST $AGENTGATE_URL/api/agents -d '{ "name": "billing-bot" }'

# OAuth2 client-credentials grant → a short-lived Bearer JWT
curl -X POST $AGENTGATE_URL/api/agents/token \
  -d '{ "client_id": "agt_…", "client_secret": "ags_…" }'
```

The agent then sends the JWT as `X-Agent-Token` on each request. AgentGate
verifies it (HS256 over the shared `JWT_SECRET`, `typ:"agent"` claim) and stamps
the **verified agent id** onto the request. See
[`agent-identity.md`](/agent-identity) for the credential types, resolution
order, liveness/revocation, and trust-boundary details.

## 2. Virtual keys (agent-scoped API keys)

An API key can be **bound to one agent** — a "virtual key." Requests made with
it are attributed to that agent automatically, no token needed:

```bash
# Bind a new key to an agent. Omit agentId for a legacy "any agent" key.
curl -X POST $AGENTGATE_URL/api/api-keys \
  -d '{ "name": "billing-bot key", "agentId": "agt_…" }'
```

The binding is checked at use time: if the agent is revoked or the key is used
for a different agent, the request is rejected (403). This is the lowest-friction
way to attribute a fleet of callers without threading tokens.

## 3. Per-agent budgets

Cap an agent's monthly spend. Spend is **reconciled from AgentLens-priced
telemetry** (actual model cost, not self-reported), so it reflects real usage.

```bash
# Set a monthly cap (USD)
curl -X PATCH $AGENTGATE_URL/api/agents/agt_…/budget -d '{ "monthlyBudgetUsd": 50 }'

# Read current spend vs cap
curl $AGENTGATE_URL/api/agents/agt_…/spend     # → { periodSpendUsd, monthlyBudgetUsd }
```

Two independent flags control behavior (both default **off**):

| Flag | Effect |
|------|--------|
| `AGENT_BUDGET_ENFORCEMENT` | An over-budget agent's next request is **denied** outright. |
| `AGENT_BUDGET_ALERTS` | Fire a `budget.threshold` notification at **80%** and **100%** (through the normal Slack/Discord/webhook dispatcher), independent of enforcement. |

Budget is a **soft guardrail**: spend is read with a short cache (re-read at 2s
freshness near the cap), so it gates the *next* action — it can't hard-stop a
request already in flight.

> **Billing-grade attribution (AgentLens #24, A+B+C shipped).** By default, spend
> attributes by the *self-reported* `agentId`, which is spoofable on the OTLP
> ingest path. With AgentLens's `BILLING_GRADE_SPEND` flag enabled, spend
> attributes only by a **cryptographically verified** agent id on **both** ingest
> paths (the agent JWT presented as `X-Agent-Token`); unverified cost is bucketed
> as *unattributed* rather than billed, and a signed **reconciliation** report
> (`POST /api/internal/reconcile`) surfaces stored-vs-recompute pricing drift per
> agent. With the flag on, per-agent spend is **billing-grade**; with it off (the
> default), it remains the soft guardrail described above. See
> AgentLens `docs/billing-grade-spend.md`.

## 4. Per-agent / per-tool policy scoping

Policies can apply globally or be **scoped** to specific agents or tools:

```jsonc
{
  "scope": "per_agent",        // "global" | "per_agent" | "per_tool"
  "agentIds": ["agt_…"],       // required when scope = per_agent
  "toolIds": ["wire_transfer"], // required when scope = per_tool
  "rules": [ /* … matcher rules … */ ]
}
```

`evaluatePolicy` filters by scope and keys on the **verified** agent/tool, then
fails closed (route to human) on any error. Matcher syntax and examples live in
[`policies.md`](/policies).

## 5. MCP tool-call guardrails

For agents calling tools over MCP, a per-agent **override** gates the call right
before it runs:

| Override action | Result |
|-----------------|--------|
| _(none)_ | allow |
| `require_approval` | escalate to a pending approval request |
| `deny` | synchronous error — the tool never runs (`deny` wins over `require_approval`) |

```bash
curl -X POST $AGENTGATE_URL/api/overrides \
  -d '{ "agentId": "agt_…", "toolPattern": "delete_*", "action": "deny" }'
```

Outcomes are audit-logged and tagged OWASP **LLM06 (Excessive Agency)**,
queryable by tool. Full details + CLI in [`mcp.md`](/mcp).

## 6. How they compose

When a request arrives, the initial decision follows a fixed **precedence**
(highest first):

1. **Budget** — an over-budget agent is **denied** (`decidedByType: budget_limiter`).
2. **Eval gate** — an agent whose latest eval pass-rate (read from AgentLens) is
   below `AGENT_EVAL_MIN_PASS_RATE` is **denied** (`decidedByType: eval_gate`).
   Opt-in via `AGENT_EVAL_GATE`; **fails open** (an un-evaluated agent or a
   telemetry outage is allowed). Requires `AGENTLENS_URL` + `AGENTGATE_SERVICE_TOKEN`
   and eval evidence federated from agenteval (agentlens#85).
3. **Override** — a matching dynamic override forces the outcome: `deny` →
   denied, otherwise → pending human review (`override`).
4. **Policy** — static policy rules decide allow / deny / route-to-human (`policy`).

The chosen layer is recorded as `decidedByType` on the audit row, alongside the
verified agent id and (for human decisions) the deciding user — so every
decision is attributable to *both* the agent that asked and the layer that
decided.

## 7. In the dashboard

Everything above has UI under **Agents**, **Policies**, and **Audit**:

- **Agents** — list agents, set/clear budgets, see spend-vs-cap, bound virtual
  keys, and per-agent tool overrides.
- **Policies** — view/edit scope + bindings, and "Clone to agents."
- **Audit** — filter by `verifiedAgentId` and `decidedByType` to see exactly
  which agent did what and which layer governed it.
