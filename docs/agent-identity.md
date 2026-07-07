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

- **Symmetric signing by default.** Agent tokens are HS256 over the shared
  `JWT_SECRET`; any service that holds that secret can both mint and verify
  them. Set `AGENT_TOKEN_SIGNING_KEY` to switch to **RS256 + JWKS** so
  downstream services verify with the *public* key only — see
  [Asymmetric signing & JWKS](#asymmetric-signing--jwks-40).
- **Liveness is local.** Cryptographic verification proves the id; it does
  **not** prove the agent is still active. Only AgentGate (which owns the
  `agents` table) can answer liveness. A stateless verifier gets identity, not
  revocation.
- **`api-key-only` mode disables tokens** entirely (the dev-placeholder secret
  would make them forgeable); the legacy header path is used instead.
- **Rate limiting.** The token endpoint is not yet rate-limited per client;
  treat a leaked `ags_…` secret as you would any credential and rotate by
  re-creating the agent.

## Asymmetric signing & JWKS (#40)

By default the same `JWT_SECRET` mints **and** verifies agent tokens, so every
downstream verifier (AgentLens, Lore) must hold it — one leak mints tokens
everywhere. Setting an RS256 signing key flips this to public-key verification:
AgentGate signs with a private key it alone holds and publishes only the public
half at a JWKS endpoint. This is **opt-in**; unset, the HS256 fast path is used
unchanged.

- **Enable:** set `AGENT_TOKEN_SIGNING_KEY` to a PKCS#8 PEM RSA private key
  (`AGENT_TOKEN_SIGNING_KEY_FILE` works for Docker secrets). Tokens are then
  signed `RS256` with a `kid` header (defaults to the JWK thumbprint, or set
  `AGENT_TOKEN_SIGNING_KID`). A malformed key fails **closed** to HS256 with a
  logged warning — it never crashes minting.
- **JWKS:** `GET /.well-known/jwks.json` (public, unauthenticated, public keys
  only) serves the active signer plus any rotation keys, `Cache-Control:
  public, max-age=300`. Downstream verifiers fetch it and verify with no shared
  secret. Returns an empty key set when asymmetric signing is off.
- **Verification path:** `verifyAgentToken` selects by the token's header `alg`
  — RS-family tokens verify against the local JWKS **pinned to `RS256`** (an
  `alg=none`/HS-swap can't down-bid), everything else uses the HS256 verifier.
  Both paths re-check `typ:"agent"`. Enabling RS256 does **not** stop AgentGate
  from also accepting HS256 tokens, so a rollout can be gradual.
- **Rotation:** set the new key as `AGENT_TOKEN_SIGNING_KEY`/`_KID` and keep the
  *previous public JWK* in `AGENT_TOKEN_VERIFY_KEYS` (a JSON array of public RSA
  JWKs, each with a `kid`) until its last issued token expires — both verify,
  only the new key signs. **Only public RSA members are ever published:** each
  rotation entry is reconstructed from a `{kty,n,e,kid}` whitelist, so pasting a
  full private JWK (or an `oct` key) by mistake cannot leak `d/p/q/...`/`k` on
  the public endpoint. A rotation entry whose `kid` collides with the active
  signer is dropped (the active key wins).
- **Audience & issuer:** `AGENT_TOKEN_AUDIENCE` mints an `aud` claim and is
  required on verify; `AGENT_TOKEN_ISSUER` mints an `iss` claim so standard
  JWKS verifiers can pin the issuer. **Both apply only to the RS256 path** — the
  HS256 fast path cannot scope `aud`/`iss`, and config validation warns if you
  set them without a signing key.
- **Known limitation:** `api-key-only` mode still rejects agent tokens even when
  RS256 is configured (the token path is gated off wholesale in that mode). An
  RS256 token is *not* forgeable there, so lifting this is a reasonable future
  change — tracked, not done in this slice.

## External SPIFFE / WIMSE workload identity (#41)

Enterprises already running a SPIFFE/SPIRE (or WIMSE) workload-identity plane can
present a **JWT-SVID** on `X-Agent-Token` instead of minting an AgentGate token.
AgentGate verifies it against the trust domain's bundle and resolves it to the
SAME verified-principal slot — the principal id is the **SPIFFE ID** itself
(e.g. `spiffe://example.org/agent/checkout`).

- **Verification:** signature checked against the trust bundle (asymmetric algs
  only — `RS*`/`PS*`/`ES*`/`EdDSA`, never HS/none); the **audience MUST match**
  `SPIFFE_AUDIENCE` (mandatory per the SPIFFE JWT-SVID spec); `exp` (and the
  optional `SPIFFE_MAX_SVID_AGE`) enforced; `sub` must be
  `spiffe://<SPIFFE_TRUST_DOMAIN>/<non-empty path>`. Verification is fail-safe —
  any error rejects the SVID, never 500s.
- **Enable:** set `SPIFFE_AUDIENCE` **and** `SPIFFE_TRUST_DOMAIN` **and** a
  bundle (`SPIFFE_JWKS_URL` or inline `SPIFFE_TRUST_BUNDLE`). All three are
  required — a partial config logs a "DISABLED" warning. Requiring the trust
  domain prevents a multi-domain/federation bundle from authenticating an
  unexpected domain.
- **Externally attested:** a SPIFFE principal is **not** looked up in the
  `agents` table (no liveness check) — the platform attests it; rely on
  short-lived SVIDs (and optionally `SPIFFE_MAX_SVID_AGE`) for revocation.
- **Limitation:** because a SPIFFE principal isn't a registered `agt_*`, it is
  **not** subject to per-agent budgets/policies (those key on the agents table) —
  binding a SPIFFE ID to a registered agent for budget/policy scoping is future
  work. Resolution order is unchanged: an AgentGate agent token wins; the SVID is
  tried only when no live agent token resolves; both are gated off in
  `api-key-only` mode.

## Delegated / on-behalf-of tokens — RFC-8693 (#43)

Unattended agent chains — an orchestrator **A** that spawns a sub-agent **B** to
act for it — need a token that records both *who is acting* (B) and *on whose
behalf* (A). AgentGate adds the [RFC-8693](https://datatracker.ietf.org/doc/html/rfc8693)
**token-exchange** grant at `POST /api/agents/token` to mint such **delegated
tokens**. Tier 1 supports **delegation** (an `act` chain is always left behind);
impersonation (no `act`) is intentionally not offered.

**Enable:** set `AGENT_TOKEN_EXCHANGE_ENABLED=true`. Delegated tokens are
**RS256-only**, so `AGENT_TOKEN_SIGNING_KEY` (#40) must also be configured — with
neither, the grant returns `unsupported_grant_type`.

**Exchange:** the actor presents **both** its own agent token (`actor_token`) and
the subject's agent token (`subject_token`, given to it by the subject):

```
POST /api/agents/token
grant_type=urn:ietf:params:oauth:grant-type:token-exchange
subject_token=<A's agent token>      # the principal (on behalf of whom)
actor_token=<B's agent token>        # the actor (who is acting)
→ { access_token, issued_token_type: "urn:ietf:params:oauth:token-type:jwt", token_type: "Bearer", expires_in }
```

**Claim shape (strict RFC-8693 §4.1):** the delegated token keeps the on-behalf-of
principal in `sub` and the current actor in the top-level `act.sub`; a chain nests
older actors inward. Both AgentGate and AgentLens read the **actor** via
`actingAgentOf()` (`act.sub ?? sub`), so per-agent budgets (#13), MCP guardrails
(#14), virtual-key binding, and AgentLens attribution all target **B (the actor)**,
while `sub` records who B acts for. A plain (non-delegated) token has no `act`, so
`sub` is the actor — existing tokens and verifiers are unchanged.

- **Verification:** both presented tokens are verified as agent tokens; the actor
  must be a **live, non-revoked** `agt_*` at exchange time (mirroring the use-time
  liveness re-check). Possession of a valid subject + actor token IS the
  authorization — this is never worse than the actor simply using the subject's
  token directly, but leaves an audit trace instead.
- **Attribution:** AgentLens stamps the principal into `verifiedOnBehalfOf`
  alongside `verifiedAgentId` (the actor), so a delegated purchase reads as
  "B acting for A".
- **Limitation (deferred):** no `may_act` restriction on *which* agents may act
  for a subject (Tier 2), and no scope/audience narrowing of the delegated token
  (Tier 3). A crafted delegation chain is bounded (`MAX_DELEGATION_DEPTH`).

## Downstream propagation (the consumer contract)

The same verified identity is intended to flow to the rest of the platform.
These are separate epics; this section is the contract they build against.

### AgentLens (Phase 2 — verify & stamp on ingest)

AgentLens events already carry an `agentId`, but it is **self-reported by the
SDK**. To make the tamper-evident audit trail *attributable*, AgentLens
verifies an AgentGate agent token at ingest and stamps the verified id.

- **Verification:** AgentLens already depends on `agentkit-auth`; it verifies
  the token with the **shared `JWT_SECRET`** and the `typ:"agent"` guard. When
  AgentGate is configured for [RS256/JWKS](#asymmetric-signing--jwks-40),
  AgentLens can instead verify against `GET /.well-known/jwks.json` and drop the
  shared-secret coupling (the consuming change is tracked separately).
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
| `JWT_ACCESS_TTL` | `900` (s) | Agent access-token lifetime. |
| `AGENT_TOKEN_SIGNING_KEY` | — | PKCS#8 PEM RSA private key → sign agent tokens with **RS256** and publish the public key at `/.well-known/jwks.json`. Unset = HS256 fast path. `_FILE` supported. |
| `AGENT_TOKEN_SIGNING_KID` | JWK thumbprint | `kid` for the active RS256 signer. |
| `AGENT_TOKEN_VERIFY_KEYS` | — | JSON array of public RSA JWKs (each with `kid`) to also publish + accept on verify — retired signers during a rotation. |
| `AGENT_TOKEN_AUDIENCE` | — | `aud` claim minted into RS256 tokens and required on verify (RS256 path only). |
| `AGENT_TOKEN_ISSUER` | — | `iss` claim minted into RS256 tokens for issuer pinning (RS256 path only). |
| `AGENT_TOKEN_EXCHANGE_ENABLED` | `false` | Enable the RFC-8693 token-exchange grant (delegated/on-behalf-of tokens, #43). Requires `AGENT_TOKEN_SIGNING_KEY` (RS256-only). |
| `SPIFFE_AUDIENCE` | — | Required SVID audience. Set with `SPIFFE_TRUST_DOMAIN` + a bundle to enable SPIFFE. |
| `SPIFFE_TRUST_DOMAIN` | — | Trust domain to pin SVID subjects to (e.g. `example.org`). Required to enable SPIFFE. |
| `SPIFFE_JWKS_URL` | — | URL of the SPIFFE trust bundle (JWKS). Validated as a URL. |
| `SPIFFE_TRUST_BUNDLE` | — | Inline trust bundle (JWKS JSON), alternative to the URL. |
| `SPIFFE_MAX_SVID_AGE` | — | Optional max SVID age in seconds (checked against `iat`). |
| `GUARDRAILS_WEBHOOK_SECRET` | — | Shared secret authenticating the reactive-guardrails webhook. |

## Security considerations

- **Never log the `ags_…` secret or a minted token.** Treat both as bearer
  credentials.
- **Sharing `JWT_SECRET` across services** (for downstream verification) widens
  the blast radius of a leak: a leaked secret lets an attacker mint agent
  tokens accepted everywhere. The [RS256/JWKS path](#asymmetric-signing--jwks-40)
  removes this coupling — downstream verifies with the public key only.
- **The unverified `context.agentId` is never trusted** for decisions; only the
  resolved verified id is.
- **Forgery is gated by the `typ:"agent"` check** plus signature; the e2e suite
  asserts that a forged user token, an expired token, and a revoked agent's
  token are all rejected (`packages/server/src/__tests__/agent-identity-e2e.test.ts`).

## Future work

- ✅ **Asymmetric signing / JWKS** (`RS256` + a published key set, `kid`
  rotation, `aud`/`iss` scoping) — shipped in #40, see
  [above](#asymmetric-signing--jwks-40).
- **RS256 tokens in `api-key-only` mode** — currently rejected wholesale even
  though they are not forgeable; allow them when a signing key is configured.
- ✅ **SPIFFE JWT-SVID / WIMSE** workload identity — shipped in #41 (JWT-SVID via
  the trust bundle, resolving to the SPIFFE ID as the principal). See
  [above](#external-spiffe--wimse-workload-identity-41). Still open: X.509-SVID
  (Workload API / mTLS), and **binding a SPIFFE ID to a registered `agt_*`** so
  per-agent budgets/policies apply.
- ✅ **RFC-8693 token exchange** for delegated/on-behalf-of agent chains — shipped
  in #43 (Tier 1: delegation via `subject_token` + `actor_token`, strict `act`
  chain, RS256-only). See [above](#delegated--on-behalf-of-tokens--rfc-8693-43).
  Still open: `may_act` restriction (Tier 2) and scope/audience narrowing (Tier 3).
- **Token-endpoint rate limiting** and a credential-rotation playbook
  (dual-active secret window).
