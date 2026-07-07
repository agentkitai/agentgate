// @agentkitai/agentgate-server — RFC-8693 token exchange (delegated agent tokens, #43).
//
// Tier 1: DELEGATION only. An actor agent (B) that holds both its own agent
// token AND a subject agent's token (A's, given to it by A) exchanges the pair
// for a short-lived DELEGATED token that says "B is acting on behalf of A".
//
// The result follows RFC-8693 §4.1 strictly: `sub` = the on-behalf-of principal
// (A), and the current actor (B) is in the top-level `act.sub`, with any prior
// delegation nested inward. Every AgentGate/AgentLens consumer reads the ACTOR
// via actingAgentOf() (act.sub ?? sub), so enforcement + attribution target B
// (the acting agent) while `sub` records who B acts for.
//
// Opt-in and RS256-only: delegated tokens are always asymmetrically signed
// (verifiable via the published JWKS, no shared secret) and require
// AGENT_TOKEN_SIGNING_KEY (#40) + AGENT_TOKEN_EXCHANGE_ENABLED. This module owns
// the minting only; the grant is wired in routes/agent-tokens.ts.

import { SignJWT } from "jose";
import type { AuthConfig } from "@agentkitai/auth";

import { AGENT_TOKEN_TYP, actingAgentOf, type ActClaim, type AgentTokenClaims } from "./agent-tokens.js";
import { getActiveSigningKey } from "./agent-token-keys.js";

/** Cap on delegation-chain depth so a crafted `act` chain can't nest unbounded. */
export const MAX_DELEGATION_DEPTH = 8;

/** Count the delegation depth of an `act` chain (0 for a plain token). */
export function delegationDepth(act: ActClaim | undefined): number {
  let n = 0;
  let cur = act;
  while (cur && n <= MAX_DELEGATION_DEPTH + 1) {
    n += 1;
    cur = cur.act;
  }
  return n;
}

/**
 * Build the RFC-8693 `act` chain + `sub` for a new delegation of `actorClaims`
 * acting on behalf of `subjectClaims`. Pure + unit-testable (no signing).
 *   - `sub`  = subjectClaims.sub          (the on-behalf-of principal, preserved through chains)
 *   - `act`  = { sub: <actor>, act?: <subject's existing chain> }   (current actor on top)
 * Returns null if the actor can't be resolved or the resulting chain is too deep.
 */
export function buildDelegatedClaims(
  subjectClaims: AgentTokenClaims,
  actorClaims: AgentTokenClaims,
): { sub: string; act: ActClaim } | null {
  const actor = actingAgentOf(actorClaims);
  if (!actor) return null;
  const act: ActClaim = { sub: actor, ...(subjectClaims.act ? { act: subjectClaims.act } : {}) };
  // Depth of the NEW chain = the subject's existing depth + this actor.
  if (delegationDepth(act) > MAX_DELEGATION_DEPTH) return null;
  return { sub: subjectClaims.sub, act };
}

export interface MintDelegatedOptions {
  /** Verified claims of the subject_token (the principal / on-behalf-of party). */
  subjectClaims: AgentTokenClaims;
  /** Verified claims of the actor_token (the agent that will wield the token). */
  actorClaims: AgentTokenClaims;
  /** Optional narrowed audience for the delegated token (RFC-8693 `audience`/`resource`). */
  audience?: string | undefined;
  config: AuthConfig;
}

/**
 * Mint a delegated RS256 agent token. Returns the compact JWT, or null when
 * delegation is unavailable (no RS256 signing key) or the claims can't be built.
 * Fail-safe: never throws — the caller maps null to an OAuth error.
 */
export async function mintDelegatedToken(opts: MintDelegatedOptions): Promise<string | null> {
  const signer = await getActiveSigningKey();
  if (!signer) return null; // RS256-only: no asymmetric signer ⇒ delegation disabled
  const built = buildDelegatedClaims(opts.subjectClaims, opts.actorClaims);
  if (!built) return null;
  try {
    // Mirror signAgentToken's inert placeholder claims (tid/role/email) so the
    // delegated token satisfies AccessTokenClaims and carries typ:"agent".
    const builder = new SignJWT({
      tid: "default",
      role: "viewer",
      email: "",
      typ: AGENT_TOKEN_TYP,
      act: built.act,
    })
      .setProtectedHeader({ alg: "RS256", kid: signer.kid, typ: "JWT" })
      .setSubject(built.sub)
      .setIssuedAt()
      .setExpirationTime(`${opts.config.jwt.accessTokenTtlSeconds}s`);
    // A requested audience narrows the token; otherwise fall back to the signer's
    // configured audience (if any). Issuer always comes from the signer.
    const audience = opts.audience ?? signer.audience;
    if (audience) builder.setAudience(audience);
    if (signer.issuer) builder.setIssuer(signer.issuer);
    return await builder.sign(signer.key);
  } catch {
    return null;
  }
}
