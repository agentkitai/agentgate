# Agent Identity

AgentGate binds a **verifiable agent identity** to the actions an autonomous
agent takes, so that guardrail decisions, approval requests, and (downstream)
observability traces and memory writes are all attributable to a specific,
revocable principal — not to an unauthenticated, caller-supplied string.

This document is the reference spec for that identity model: the credential
types, how a token is minted and verified, where the verified id is stamped,
the trust boundary and its limits, and the contract downstream services
(AgentLens, Lore) use to consume the identity.

> Status: the AgentGate core spine is implemented (issue #12). SPIFFE/WIMSE and
> asymmetric (JWKS) verification are explicit non-goals for now — see
> [Future work](#future-work).

## Why

An agent calling AgentGate today can put *any* `agentId` in the request body.
That claim is unauthenticated: a misconfigured or malicious agent can
impersonate another, and an audit trail keyed on it proves nothing. The agent
identity spine replaces that claim, on the paths that matter, with a
cryptographically verified id resolved from a credential the agent actually
holds.

The verified id is deliberately kept **separate** from the unverified
`context.agentId` claim — both can appear on a request; only the verified one
is trusted for decisions and recorded as evidence.

## Credential types

| Credential | Format | Lifetime | Where used |
|---|---|---|---|
| **Agent registry secret** | `client_id` = `agt_…`, `client_secret` = `ags_…` | Long-lived (until revoked/rotated) | Exchanged once at the token endpoint; or sent directly as legacy headers |
| **Agent access token** | Short-lived HS256 JWT, `typ:"agent"` | `jwtAccessTtl` (default 900s) | Presented as `X-Agent-Token` on each request |

An agent is a row in the `agents` registry (`packages/server/src/db/schema.*`):
`id` (`agt_…`), `name`, `secretHash` (SHA-256 of the `ags_…` secret),
`status` (`active` | `revoked`), `revokedAt`, optional `monthlyBudgetUsd`. The
plaintext secret is shown once at creation and never stored.

### OAuth2 client-credentials grant

`POST /api/agents/token` implements the OAuth2 `client_credentials` grant
(`packages/server/src/routes/agent-tokens.ts`). The agent presents its
`agt_…` / `ags_…` pair as a JSON body or HTTP Basic credentials:

```http
POST /api/agents/token
Content-Type: application/json

{ "grant_type": "client_credentials", "client_id": "agt_…", "client_secret": "ags_…" }
```

```json
{ "access_token": "<jwt>", "token_type": "Bearer", "expires_in": 900 }
```

The returned JWT carries `{ sub: <agt_id>, typ: "agent", iat, exp, … }` and is
signed with the server's shared `JWT_SECRET` (HS256). The `typ:"agent"` claim
is **load-bearing**: it is the sole discriminator that prevents a user session
token (same signer) from being accepted on an agent path, and vice versa. The
token endpoint returns `400` in `api-key-only` auth mode (no real JWT secret is
configured there, so a token would be forgeable).

The agent then sends the token instead of its long-lived secret:

```http
POST /api/requests
X-Agent-Token: <jwt>
```

## Verification & resolution order

`resolveVerifiedAgentId()` (`packages/server/src/lib/agent-tokens.ts`) resolves
the verified id for an inbound request, preferring the strongest credential:

1. **`X-Agent-Token`** (preferred) — verify the JWT signature **and**
   `typ:"agent"`; then **re-check liveness at use time** via
   `getAgentIfActive()` (a stateless token can outlive a revoke). Disabled in
   `api-key-only` mode.
2. **`X-Agent-Id` / `X-Agent-Secret`** (legacy fallback) — constant-time hash
   comparison against the registry.
3. Otherwise → `null` (no verified identity; the request proceeds *unverified*).

On routes that also support **virtual keys** (an API key bound to an agent,
issue #13), `resolveEffectiveAgentId()` reconciles the key binding with the
separately verified id:

- a key bound to an agent **is** that agent's credential → the binding is
  authoritative and promotes to the verified id;
- a request that *separately* verifies as a **different** agent → `403`
  (conflict);
- a binding to a **revoked/unknown** agent → `403` (the bound agent's liveness
  is re-checked here too, because revoking an agent does not cascade to keys).

## Where the verified id is stamped

| Surface | Behavior |
|---|---|
| `POST /api/requests` | `approvalRequests.verifiedAgentId` is set to the effective verified id; the `created` audit entry records `verifiedAgentId`. Overrides and policies are scoped on it (resolved *before* policy evaluation). |
| `POST /api/mcp/authorize` | The MCP tool-call gate keys on the verified id (an MCP server's virtual-key binding). |
| `POST /api/guardrails/webhook` | A breach only creates an override when its `agentId` resolves to a **registered, active** agent (`getAgentIfActive`); breaches for unknown or revoked agents are ignored. The id is supplied by AgentLens over a shared-secret channel and is not a credential, so this registry check is the available "verified identity" guarantee on this path. |

The audit log thus records **both** the human decision-maker (from the OIDC
user context, on the decision endpoint) and the agent that made the request
(from the verified credential) — the accountability pair regulated AI needs.

## Revocation

`revokeAgent(id)` sets `status='revoked'` + `revokedAt`. Because verification
re-checks `getAgentIfActive()` at use time, a revoked agent is rejected
immediately on its next call **even if a previously minted token is still
within its TTL**. There is no separate token-revocation list; revoke the agent.

## Trust model & limits

- **Symmetric signing.** Agent tokens are HS256 over the shared `JWT_SECRET`.
  Any service that holds that secret can both mint and verify agent tokens.
  There is no `kid`, no `aud`, and no asymmetric/JWKS option today.
- **Liveness is local.** Cryptographic verification proves the id; it does
  **not** prove the agent is still active. Only AgentGate (which owns the
  `agents` table) can answer liveness. A stateless verifier gets identity, not
  revocation.
- **`api-key-only` mode disables tokens** entirely (the dev-placeholder secret
  would make them forgeable); the legacy header path is used instead.
- **Rate limiting.** The token endpoint is not yet rate-limited per client;
  treat a leaked `ags_…` secret as you would any credential and rotate by
  re-creating the agent.

## Downstream propagation (the consumer contract)

The same verified identity is intended to flow to the rest of the platform.
These are separate epics; this section is the contract they build against.

### AgentLens (Phase 2 — verify & stamp on ingest)

AgentLens events already carry an `agentId`, but it is **self-reported by the
SDK**. To make the tamper-evident audit trail *attributable*, AgentLens
verifies an AgentGate agent token at ingest and stamps the verified id.

- **Verification:** AgentLens already depends on `agentkit-auth`; it verifies
  the token with the **shared `JWT_SECRET`** and the `typ:"agent"` guard. (A
  JWKS/asymmetric option would remove the shared-secret coupling — see
  [Future work](#future-work).)
- **Where it lands:** the verified id is written to event **metadata**
  (e.g. `metadata.verifiedAgentId`, `verificationMethod`, `verifiedAt`), **not**
  added to the hashed event fields. AgentLens events are SHA-256 hash-chained;
  changing the hashed field set would invalidate every existing chain. Metadata
  is covered by the chain as a whole, so this stays tamper-evident without a
  hash-version migration.
- **Liveness:** ingest performs cryptographic verification only; it does not
  call back to AgentGate per event. Tokens are short-lived, which bounds the
  staleness.

### Lore (Phase 3 — principal binding)

Lore already binds every memory to its writing principal
(`AuthContext.principal_id`) and filters reads by it (private/shared
visibility). Phase 3 is to **recognize an AgentGate agent token as a
principal** (alongside API-key and OIDC principals) and, optionally, to tag the
principal *type* (`user` | `agent` | `service`) for audit and recall semantics.
The ownership-binding and visibility machinery already exist; this is a
formalization, not a new subsystem.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET` | — (required when JWT/OIDC auth is enabled) | Shared HS256 secret used to sign **and** verify agent tokens. Must be ≥32 chars and not the dev placeholder. |
| `JWT_SECRET_FILE` | — | File-based alternative to `JWT_SECRET`. |
| `AUTH_MODE` | `dual` | `api-key-only` disables the agent-token path (legacy headers only). |
| `jwtAccessTtl` | `900` (s) | Agent access-token lifetime. |
| `GUARDRAILS_WEBHOOK_SECRET` | — | Shared secret authenticating the reactive-guardrails webhook. |

## Security considerations

- **Never log the `ags_…` secret or a minted token.** Treat both as bearer
  credentials.
- **Sharing `JWT_SECRET` across services** (for downstream verification) widens
  the blast radius of a leak: a leaked secret lets an attacker mint agent
  tokens accepted everywhere. Prefer a dedicated rotation process; the JWKS
  path (future) removes this coupling.
- **The unverified `context.agentId` is never trusted** for decisions; only the
  resolved verified id is.
- **Forgery is gated by the `typ:"agent"` check** plus signature; the e2e suite
  asserts that a forged user token, an expired token, and a revoked agent's
  token are all rejected (`packages/server/src/__tests__/agent-identity-e2e.test.ts`).

## Future work

- **Asymmetric signing / JWKS** (`RS256` + a published key set) so downstream
  services verify without sharing `JWT_SECRET`, with `kid`-based rotation.
- **`aud` scoping** so a token is only valid for its intended consumer.
- **SPIFFE SVID / WIMSE** workload identity for mesh deployments
  (X.509 / Workload API), resolving to the same verified principal.
- **RFC-8693 token exchange** for delegated/on-behalf-of agent chains.
- **Token-endpoint rate limiting** and a credential-rotation playbook
  (dual-active secret window).
