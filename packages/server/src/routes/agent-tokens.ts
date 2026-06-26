// @agentkitai/agentgate-server — Agent OAuth2 token endpoint (agent-identity spine).
//
// POST /api/agents/token — RFC 6749 client_credentials grant. An agent presents
// its agt_*/ags_* credential (JSON body or HTTP Basic) and receives a
// short-lived Bearer JWT to use as X-Agent-Token. PUBLIC: mounted before the
// user-auth middleware — the agent's own credential is the authentication.

import { Hono, type Context } from "hono";

import { verifyAgentCredential } from "../lib/agents.js";
import { signAgentToken } from "../lib/agent-tokens.js";
import { getAuthConfig } from "../lib/auth-config.js";
import { getConfig } from "../config.js";

const router = new Hono();

/** Pull client_id/client_secret/grant_type from HTTP Basic (preferred) or body. */
async function parseCredentials(c: Context): Promise<{
  clientId?: string;
  clientSecret?: string;
  grantType?: string;
}> {
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

  let grantType: string | undefined;
  const ctype = c.req.header("content-type") ?? "";
  if (ctype.includes("application/json")) {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    grantType = typeof body.grant_type === "string" ? body.grant_type : undefined;
    clientId ??= typeof body.client_id === "string" ? body.client_id : undefined;
    clientSecret ??= typeof body.client_secret === "string" ? body.client_secret : undefined;
  } else {
    // RFC 6749 norm: application/x-www-form-urlencoded.
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    grantType = typeof form.grant_type === "string" ? form.grant_type : undefined;
    clientId ??= typeof form.client_id === "string" ? form.client_id : undefined;
    clientSecret ??= typeof form.client_secret === "string" ? form.client_secret : undefined;
  }

  return { clientId, clientSecret, grantType };
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

  const { clientId, clientSecret, grantType } = await parseCredentials(c);
  if (grantType !== "client_credentials") {
    return c.json({ error: "unsupported_grant_type" }, 400);
  }

  const agent = await verifyAgentCredential(clientId, clientSecret);
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
