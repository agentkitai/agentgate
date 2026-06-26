// @agentkitai/agentgate-server — Accept an external SPIFFE JWT-SVID as a verified principal (#41).
//
// Enterprises that already run a SPIFFE/SPIRE (or WIMSE) workload-identity plane
// can present a JWT-SVID instead of minting an AgentGate agent token. AgentGate
// verifies the SVID against the trust domain's published keys (the trust bundle,
// a JWKS) and resolves it to the SAME verified-principal slot the agent-token
// path uses — the principal id is the SPIFFE ID itself (e.g.
// `spiffe://example.org/agent/checkout`). SPIFFE IDs are externally attested by
// the platform, so they are NOT required to exist in AgentGate's `agents` table
// (binding a SPIFFE id to a registered agt_* for budgets/policies is a future
// add — see docs/agent-identity.md).
//
// Per the SPIFFE JWT-SVID spec the verifier MUST validate the audience, so the
// feature is OFF unless BOTH a trust-bundle source AND SPIFFE_AUDIENCE are set.
// WIMSE Workload Identity Tokens are the same JWS-over-JWKS shape and verify
// through this path once their issuer's keys are configured as the bundle.

import { jwtVerify, createRemoteJWKSet, createLocalJWKSet, type JWK } from "jose";

import { getConfig } from "../config.js";

// SPIFFE JWT-SVIDs are signed with an asymmetric alg; never accept HS*/none.
const SPIFFE_ALGS = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"];

type Verifier = ReturnType<typeof createRemoteJWKSet> | ReturnType<typeof createLocalJWKSet>;

interface SpiffeState {
  verifier: Verifier | null;
  audience: string | null;
  trustDomain: string | null;
  maxTokenAge: number | null;
}

const DISABLED: SpiffeState = { verifier: null, audience: null, trustDomain: null, maxTokenAge: null };

let cache: SpiffeState | null = null;

function build(): SpiffeState {
  const cfg = getConfig();
  const audience = cfg.spiffeAudience?.trim() || null;
  const trustDomain = cfg.spiffeTrustDomain?.trim() || null;
  const url = cfg.spiffeJwksUrl?.trim();
  const inline = cfg.spiffeTrustBundle?.trim();
  const maxTokenAge = cfg.spiffeMaxSvidAge ?? null;

  // Both are mandatory: audience per the SPIFFE spec; trust domain so a
  // multi-domain/federation bundle can't authenticate an unexpected domain as a
  // fully-verified principal. Missing either → feature off.
  if (!audience || !trustDomain) return DISABLED;

  let verifier: Verifier | null = null;
  if (url) {
    // URL is operator config (not attacker-controlled) → no SSRF. Pin fetch
    // behaviour so a slow trust-bundle endpoint can't stall request handling.
    // new URL can throw on a malformed value — fail closed (disabled), never
    // let it propagate to the request hot path.
    try {
      verifier = createRemoteJWKSet(new URL(url), {
        timeoutDuration: 2500,
        cooldownDuration: 30_000,
        cacheMaxAge: 600_000,
      });
    } catch {
      console.error("Warning: SPIFFE_JWKS_URL is not a valid URL; SPIFFE verification disabled");
    }
  } else if (inline) {
    try {
      const parsed = JSON.parse(inline) as { keys?: JWK[] };
      if (Array.isArray(parsed.keys) && parsed.keys.length > 0) {
        verifier = createLocalJWKSet(parsed as { keys: JWK[] });
      } else {
        console.error("Warning: SPIFFE_TRUST_BUNDLE has no keys; SPIFFE verification disabled");
      }
    } catch {
      console.error("Warning: SPIFFE_TRUST_BUNDLE is not valid JWKS JSON; SPIFFE verification disabled");
    }
  }

  return verifier ? { verifier, audience, trustDomain, maxTokenAge } : DISABLED;
}

function state(): SpiffeState {
  return (cache ??= build());
}

/** Drop the cached SPIFFE verifier (tests + after a config change). */
export function __resetSpiffeCache(): void {
  cache = null;
}

/** True when SPIFFE SVID verification is configured (a trust bundle AND an audience). */
export function spiffeEnabled(): boolean {
  return state().verifier !== null;
}

/**
 * Verify a token AS a SPIFFE JWT-SVID. Returns the SPIFFE ID (`sub`, e.g.
 * `spiffe://td/workload`) iff: the signature is valid against the trust bundle,
 * the algorithm is asymmetric, the audience matches SPIFFE_AUDIENCE, `exp` (and
 * the optional max age) are valid, and `sub` is `spiffe://<trust-domain>/<path>`
 * with a non-empty workload path. Otherwise null. Never throws.
 */
export async function verifySpiffeSvid(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const { verifier, audience, trustDomain, maxTokenAge } = state();
  if (!verifier || !audience || !trustDomain) return null;

  try {
    const { payload } = await jwtVerify(token, verifier, {
      algorithms: SPIFFE_ALGS,
      audience, // SPIFFE spec: audience validation is mandatory.
      ...(maxTokenAge ? { maxTokenAge } : {}),
    });
    const sub = payload.sub;
    if (typeof sub !== "string") return null;
    // Pin to the expected trust domain (the trailing slash blocks suffix attacks
    // like spiffe://example.org.evil/…) AND require a non-empty workload path.
    const prefix = `spiffe://${trustDomain}/`;
    if (!sub.startsWith(prefix) || sub.length <= prefix.length) return null;
    return sub;
  } catch {
    return null;
  }
}
