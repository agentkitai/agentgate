// @agentgate/server — Agent OAuth2 token helpers (agent-identity spine).
//
// An agent exchanges its long-lived secret (ags_*) once at the token endpoint
// for a short-lived Bearer JWT, then presents the JWT (X-Agent-Token) instead
// of sending the secret on every call. Tokens are signed with the SAME
// JWT_SECRET and helpers as user sessions; a `typ:"agent"` claim is the sole
// discriminator that keeps an agent token from being accepted as a user
// session (and vice versa) — verifyAccessToken only checks the signature, not
// the claim, so this check is load-bearing and must not be dropped.

import { signAccessToken, verifyAccessToken, type AuthConfig } from "agentkit-auth";
import { SignJWT, jwtVerify, decodeProtectedHeader } from "jose";

import { getAgentIfActive, verifyAgentCredential } from "./agents.js";
import { getAuthConfig } from "./auth-config.js";
import {
  getActiveSigningKey,
  getJwksVerifier,
  getAgentTokenAudience,
} from "./agent-token-keys.js";

export const AGENT_TOKEN_TYP = "agent";

/**
 * Mint a short-lived agent access token. sub = agt_* id; exp from config TTL.
 * When an RS256 signing key is configured (#40) the token is signed
 * asymmetrically with that key's kid (and aud, if set); otherwise it is signed
 * with the shared HS256 JWT_SECRET — the default local fast path, unchanged.
 */
export async function signAgentToken(agentId: string, config: AuthConfig): Promise<string> {
  // tid/role/email satisfy AccessTokenClaims' required fields but are inert:
  // agent tokens never flow through the user RBAC path (see middleware/auth.ts).
  const signer = await getActiveSigningKey();
  if (signer) {
    const builder = new SignJWT({ tid: "default", role: "viewer", email: "", typ: AGENT_TOKEN_TYP })
      .setProtectedHeader({ alg: "RS256", kid: signer.kid, typ: "JWT" })
      .setSubject(agentId)
      .setIssuedAt()
      .setExpirationTime(`${config.jwt.accessTokenTtlSeconds}s`);
    if (signer.audience) builder.setAudience(signer.audience);
    if (signer.issuer) builder.setIssuer(signer.issuer);
    return builder.sign(signer.key);
  }
  return signAccessToken(
    { sub: agentId, tid: "default", role: "viewer", email: "", typ: AGENT_TOKEN_TYP },
    config,
  );
}

/**
 * Verify a Bearer token AS an agent token. Returns the agent id (sub) iff the
 * signature is valid AND typ === "agent"; otherwise null — including for valid
 * USER tokens, which must never cross over into the agent path.
 *
 * The token's header `alg` selects the path: RS256-family tokens verify against
 * the local JWKS (#40, pinned to RS256 so an HS256/none token can't down-bid),
 * everything else uses the shared-secret HS256 verifier. Both paths re-check
 * `typ === "agent"`; the RS256 path also enforces the configured audience.
 */
export async function verifyAgentToken(
  token: string | undefined,
  config: AuthConfig,
): Promise<string | null> {
  if (!token) return null;

  let alg: unknown;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    return null; // not a well-formed JWS
  }

  if (typeof alg === "string" && alg.startsWith("RS")) {
    // Whole branch is fail-safe: any resolver/verify error rejects the token
    // (returns null) rather than throwing a 500 — an attacker can send alg=RS256
    // at will, so this must never surface as a server error.
    try {
      const verifier = await getJwksVerifier();
      if (!verifier) return null; // asymmetric token but no keys configured → reject
      const audience = getAgentTokenAudience();
      const { payload } = await jwtVerify(token, verifier, {
        algorithms: ["RS256"],
        ...(audience ? { audience } : {}),
      });
      if ((payload as Record<string, unknown>).typ !== AGENT_TOKEN_TYP) return null;
      return typeof payload.sub === "string" ? payload.sub : null;
    } catch {
      return null;
    }
  }

  const claims = await verifyAccessToken(token, config);
  if (!claims) return null;
  if ((claims as Record<string, unknown>).typ !== AGENT_TOKEN_TYP) return null;
  return typeof claims.sub === "string" ? claims.sub : null;
}

/**
 * Resolve the VERIFIED agent id for an inbound request, or null. Prefers a
 * short-lived agent Bearer token (X-Agent-Token); falls back to the legacy
 * long-lived X-Agent-Id / X-Agent-Secret headers. The token path is disabled
 * in api-key-only mode, where the JWT signing secret is the public dev
 * placeholder and a token would therefore be forgeable.
 */
export async function resolveVerifiedAgentId(
  creds: { agentToken?: string; agentId?: string; agentSecret?: string },
  authMode: string,
): Promise<string | null> {
  if (authMode !== "api-key-only" && creds.agentToken) {
    const tokenAgentId = await verifyAgentToken(creds.agentToken, getAuthConfig());
    // Re-check active status at USE time: a stateless token can outlive a revoke.
    if (tokenAgentId) {
      const live = await getAgentIfActive(tokenAgentId);
      if (live) return live;
    }
  }
  return (await verifyAgentCredential(creds.agentId, creds.agentSecret))?.id ?? null;
}

/**
 * Reconcile a virtual-key agent binding (issue #13) with the separately
 * verified agent id. A key bound to an agent IS that agent's credential, so the
 * binding is authoritative and promotes to the verified id. A DIFFERENT
 * separately-verified agent on the same request is an unresolvable conflict.
 * Returns { agentId } on success, or { conflict: true } when they disagree.
 */
export function reconcileBoundAgent(
  boundAgentId: string | null,
  verifiedAgentId: string | null,
): { agentId: string | null } | { conflict: true } {
  if (!boundAgentId) return { agentId: verifiedAgentId };
  if (verifiedAgentId && verifiedAgentId !== boundAgentId) return { conflict: true };
  return { agentId: boundAgentId };
}

/**
 * Resolve the effective verified agent id for a request, accounting for a
 * virtual-key binding (issue #13). The binding is authoritative, but the bound
 * agent must still be ACTIVE at use time — mirroring the agent-token path,
 * because revoking an agent does not cascade to keys bound to it. Returns the
 * effective id, or a typed rejection the route maps to 403:
 *   - "conflict":         the request separately verifies as a different agent
 *   - "revoked_binding":  the key is bound to a revoked/unknown agent
 */
export async function resolveEffectiveAgentId(
  boundAgentId: string | null,
  verifiedAgentId: string | null,
): Promise<{ agentId: string | null } | { reject: "conflict" | "revoked_binding" }> {
  const reconciled = reconcileBoundAgent(boundAgentId, verifiedAgentId);
  if ("conflict" in reconciled) return { reject: "conflict" };
  if (boundAgentId && !(await getAgentIfActive(boundAgentId))) {
    return { reject: "revoked_binding" };
  }
  return { agentId: reconciled.agentId };
}
