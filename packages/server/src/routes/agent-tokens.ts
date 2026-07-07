// @agentkitai/agentgate-server — Agent OAuth2 token endpoint (agent-identity spine).
//
// POST /api/agents/token supports two grants:
//   - client_credentials (RFC 6749): an agent presents its agt_*/ags_* credential
//     and receives a short-lived Bearer JWT to use as X-Agent-Token.
//   - urn:ietf:params:oauth:grant-type:token-exchange (RFC 8693, #43): an actor
//     agent presents its own agent token (actor_token) AND a subject agent's token
//     (subject_token) and receives a DELEGATED token ("actor acting on behalf of
//     subject"). Opt-in (AGENT_TOKEN_EXCHANGE_ENABLED) + RS256-only.
// PUBLIC: mounted before the user-auth middleware — the presented credential/token
// IS the authentication.

import { Hono, type Context } from "hono";

import { getAgentIfActive, verifyAgentCredential } from "../lib/agents.js";
import { actingAgentOf, signAgentToken, verifyAgentTokenClaims } from "../lib/agent-tokens.js";
import { mintDelegatedToken } from "../lib/token-exchange.js";
import { getActiveSigningKey } from "../lib/agent-token-keys.js";
import { getAuthConfig } from "../lib/auth-config.js";
import { getConfig } from "../config.js";

const router = new Hono();

const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
/** RFC-8693 issued-token-type for a self-contained JWT. */
const JWT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:jwt";

interface TokenParams {
  grantType?: string;
  clientId?: string;
  clientSecret?: string;
  subjectToken?: string;
  actorToken?: string;
}

/** Pull grant + client_credentials + token-exchange params from HTTP Basic or the body. */
async function parseParams(c: Context): Promise<TokenParams> {
  let clientId: string | undefined;
  let clientSecret: string | undefined;

  const authz = c.req.header("authorization");
  if (authz?.startsWith("Basic ")) {
    const decoded = Buffer.from(authz.slice(6), "base64").toString("utf-8");
    const i = decoded.indexOf(":");
    if (i >= 0) {
      clientId = decoded.slice(0, i);
      clientSecret = decoded.slice(i + 1);
    }
  }

  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  const ctype = c.req.header("content-type") ?? "";
  const body = ctype.includes("application/json")
    ? ((await c.req.json().catch(() => ({}))) as Record<string, unknown>)
    : ((await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>);

  clientId ??= str(body["client_id"]);
  clientSecret ??= str(body["client_secret"]);
  return {
    grantType: str(body["grant_type"]),
    clientId,
    clientSecret,
    subjectToken: str(body["subject_token"]),
    actorToken: str(body["actor_token"]),
  };
}

/**
 * RFC-8693 token exchange (Tier 1: delegation only). Requires BOTH subject_token
 * (the principal) and actor_token (the actor) — an omitted actor_token would be
 * impersonation, which is deliberately NOT supported (a delegated token always
 * leaves an `act` trace). Possession of a valid actor_token + subject_token is
 * the authorization (a may_act restriction is Tier 2). The result is enforced +
 * attributed to the ACTOR, with the on-behalf-of principal in `sub`.
 */
async function handleTokenExchange(c: Context, params: TokenParams): Promise<Response> {
  const cfg = getConfig();
  // Off unless explicitly enabled AND an RS256 signer exists (delegated tokens
  // are RS256-only). Same response as an unknown grant so we leak no capability.
  if (!cfg.agentTokenExchangeEnabled || !(await getActiveSigningKey())) {
    return c.json({ error: "unsupported_grant_type" }, 400);
  }
  if (!params.subjectToken || !params.actorToken) {
    return c.json(
      {
        error: "invalid_request",
        error_description: "token exchange requires both subject_token and actor_token",
      },
      400,
    );
  }

  const authConfig = getAuthConfig();
  const subjectClaims = await verifyAgentTokenClaims(params.subjectToken, authConfig);
  const actorClaims = await verifyAgentTokenClaims(params.actorToken, authConfig);
  if (!subjectClaims || !actorClaims) {
    // One of the presented tokens is not a valid agent token.
    return c.json(
      { error: "invalid_grant", error_description: "invalid subject_token or actor_token" },
      400,
    );
  }

  // The actor must be a live, non-revoked agent at exchange time (mirrors the
  // use-time liveness re-check on the resolve path).
  const actorId = actingAgentOf(actorClaims);
  if (!(await getAgentIfActive(actorId))) {
    return c.json(
      { error: "invalid_grant", error_description: "actor is not an active agent" },
      400,
    );
  }

  const token = await mintDelegatedToken({ subjectClaims, actorClaims, config: authConfig });
  if (!token) {
    // Unreachable in practice (signer checked above); guards a too-deep chain.
    return c.json(
      { error: "invalid_request", error_description: "could not mint delegated token" },
      400,
    );
  }
  return c.json({
    access_token: token,
    issued_token_type: JWT_TOKEN_TYPE,
    token_type: "Bearer",
    expires_in: cfg.jwtAccessTtl,
  });
}

router.post("/", async (c) => {
  if (getConfig().authMode === "api-key-only") {
    return c.json(
      {
        error: "unsupported_grant_type",
        error_description: "JWT auth is disabled (AUTH_MODE=api-key-only)",
      },
      400,
    );
  }

  const params = await parseParams(c);

  if (params.grantType === TOKEN_EXCHANGE_GRANT) {
    return handleTokenExchange(c, params);
  }
  if (params.grantType !== "client_credentials") {
    return c.json({ error: "unsupported_grant_type" }, 400);
  }

  const agent = await verifyAgentCredential(params.clientId, params.clientSecret);
  if (!agent) {
    // Identical response for unknown id vs bad/revoked secret — no enumeration.
    return c.json({ error: "invalid_client" }, 401);
  }

  const token = await signAgentToken(agent.id, getAuthConfig());
  return c.json({
    access_token: token,
    token_type: "Bearer",
    expires_in: getConfig().jwtAccessTtl,
  });
});

export default router;
