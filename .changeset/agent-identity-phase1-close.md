---
"@agentgate/server": patch
---

Close out the agent-identity spine (#12) foundation: add the formal identity spec, a verified-identity check on the reactive-guardrails webhook, and real-route end-to-end tests.

- **docs/agent-identity.md** — reference spec for the model as built: credential types (`agt_*`/`ags_*` + short-lived `typ:"agent"` JWT), the OAuth2 client-credentials token flow, resolution order (token > virtual-key binding > legacy headers), use-time liveness/revocation, the HS256 shared-secret trust boundary and its limits, and the downstream-propagation contract for AgentLens (verify + stamp into event metadata, not the hash) and Lore (principal binding).
- **Guardrails webhook** — `POST /api/guardrails/webhook` now only creates an override on breach when the reported `agentId` resolves to a registered, active agent (`getAgentIfActive`); breaches for unknown or revoked agents are ignored. This avoids creating override rows that were already inert for such agents (override matching keys on the *verified* agent id, which an unverified/unknown agent never obtains). The registry lookup **fails open**: on a transient DB error the override is still applied, so a breach is never silently dropped during an outage.
- **E2E tests** (`agent-identity-e2e.test.ts`) — drive the real routes against a real in-memory DB: OAuth2 token → `POST /api/requests` → verified id persisted on the approval request and stamped into the audit trail; plus the negative paths (forged user token, revoked agent, expired token) all rejected.
