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

import { getAgentIfActive, verifyAgentCredential } from "./agents.js";
import { getAuthConfig } from "./auth-config.js";

export const AGENT_TOKEN_TYP = "agent";

/** Mint a short-lived agent access token. sub = agt_* id; exp from config TTL. */
export async function signAgentToken(agentId: string, config: AuthConfig): Promise<string> {
  // tid/role/email satisfy AccessTokenClaims' required fields but are inert:
  // agent tokens never flow through the user RBAC path (see middleware/auth.ts).
  return signAccessToken(
    { sub: agentId, tid: "default", role: "viewer", email: "", typ: AGENT_TOKEN_TYP },
    config,
  );
}

/**
 * Verify a Bearer token AS an agent token. Returns the agent id (sub) iff the
 * signature is valid AND typ === "agent"; otherwise null — including for valid
 * USER tokens, which must never cross over into the agent path.
 */
export async function verifyAgentToken(
  token: string | undefined,
  config: AuthConfig,
): Promise<string | null> {
  if (!token) return null;
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
