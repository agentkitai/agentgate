/**
 * Agent OAuth2 client-credentials token endpoint + token helpers (#12, PR2).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { signAccessToken, type AuthConfig } from "agentkit-auth";
import * as schema from "../db/schema.js";

const sqlite = new Database(":memory:");
const db = drizzle(sqlite, { schema });

sqlite.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  secret_hash text NOT NULL,
  status text NOT NULL,
  metadata text,
  created_at integer NOT NULL,
  last_seen_at integer,
  revoked_at integer,
  monthly_budget_usd real
);
`);

vi.mock("../db/index.js", () => ({ getDb: () => db }));

import { createAgent, revokeAgent, getAgentIfActive } from "../lib/agents.js";
import {
  signAgentToken,
  verifyAgentToken,
  resolveVerifiedAgentId,
} from "../lib/agent-tokens.js";
import agentTokenRouter from "../routes/agent-tokens.js";
import { parseConfig, setConfig, resetConfig } from "../config.js";

const TEST_SECRET = "test-jwt-secret-at-least-32-chars-long!!";

/** Standalone AuthConfig for the pure-lib JWT tests (no config singleton). */
function authConfig(secret = TEST_SECRET): AuthConfig {
  return {
    oidc: null,
    jwt: { secret, accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 604800 },
    authDisabled: false,
  };
}

function app() {
  const a = new Hono();
  a.route("/api/agents/token", agentTokenRouter);
  return a;
}

async function postToken(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return app().request("/api/agents/token", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  sqlite.exec("DELETE FROM agents");
  setConfig(parseConfig({ jwtSecret: TEST_SECRET })); // authMode defaults to "dual"
});

afterAll(() => {
  resetConfig();
  sqlite.close();
});

describe("agent-tokens lib", () => {
  it("round-trips a minted agent token back to its agent id", async () => {
    const t = await signAgentToken("agt_abc", authConfig());
    expect(await verifyAgentToken(t, authConfig())).toBe("agt_abc");
  });

  it("rejects a USER token (no typ:agent) — prevents cross-over", async () => {
    const userTok = await signAccessToken(
      { sub: "user_1", tid: "default", role: "admin", email: "u@x.io" },
      authConfig(),
    );
    expect(await verifyAgentToken(userTok, authConfig())).toBeNull();
  });

  it("rejects a tampered token, a wrong-secret token, and undefined", async () => {
    const t = await signAgentToken("agt_abc", authConfig());
    expect(await verifyAgentToken(`${t.slice(0, -2)}xx`, authConfig())).toBeNull();
    const fromOther = await signAgentToken("agt_abc", authConfig("a-totally-different-secret-32-chars-x"));
    expect(await verifyAgentToken(fromOther, authConfig())).toBeNull();
    expect(await verifyAgentToken(undefined, authConfig())).toBeNull();
  });
});

describe("POST /api/agents/token", () => {
  it("mints a Bearer token for a valid JSON credential", async () => {
    const { agent, secret } = await createAgent("ci");
    const res = await postToken({
      grant_type: "client_credentials",
      client_id: agent.id,
      client_secret: secret,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(900);
    expect(typeof body.access_token).toBe("string");
    expect(await verifyAgentToken(body.access_token as string, authConfig())).toBe(agent.id);
  });

  it("accepts HTTP Basic credentials", async () => {
    const { agent, secret } = await createAgent("ci");
    const basic = Buffer.from(`${agent.id}:${secret}`).toString("base64");
    const res = await postToken({ grant_type: "client_credentials" }, { authorization: `Basic ${basic}` });
    expect(res.status).toBe(200);
  });

  it("returns 401 invalid_client for bad secret AND unknown id (no enumeration)", async () => {
    const { agent } = await createAgent("ci");
    const bad = await postToken({
      grant_type: "client_credentials",
      client_id: agent.id,
      client_secret: "ags_wrong",
    });
    expect(bad.status).toBe(401);
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_client");

    const missing = await postToken({
      grant_type: "client_credentials",
      client_id: "agt_nope",
      client_secret: "ags_x",
    });
    expect(missing.status).toBe(401);
    expect(((await missing.json()) as { error: string }).error).toBe("invalid_client");
  });

  it("returns 401 for a revoked agent", async () => {
    const { agent, secret } = await createAgent("ci");
    await revokeAgent(agent.id);
    const res = await postToken({
      grant_type: "client_credentials",
      client_id: agent.id,
      client_secret: secret,
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 unsupported_grant_type for a missing grant", async () => {
    const { agent, secret } = await createAgent("ci");
    const res = await postToken({ client_id: agent.id, client_secret: secret });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("unsupported_grant_type");
  });

  it("returns 400 in api-key-only mode (JWT disabled)", async () => {
    setConfig(parseConfig({ jwtSecret: TEST_SECRET, authMode: "api-key-only" }));
    const { agent, secret } = await createAgent("ci");
    const res = await postToken({
      grant_type: "client_credentials",
      client_id: agent.id,
      client_secret: secret,
    });
    expect(res.status).toBe(400);
  });
});

describe("use-time revocation (the requests-route guard)", () => {
  it("a still-valid token stops resolving once the agent is revoked", async () => {
    const { agent } = await createAgent("ci");
    const token = await signAgentToken(agent.id, authConfig());
    expect(await verifyAgentToken(token, authConfig())).toBe(agent.id); // signature still valid
    await revokeAgent(agent.id);
    expect(await getAgentIfActive(agent.id)).toBeNull(); // ...but the use-time check rejects it
  });

  it("getAgentIfActive returns the id for active, null for missing", async () => {
    const { agent } = await createAgent("ci");
    expect(await getAgentIfActive(agent.id)).toBe(agent.id);
    expect(await getAgentIfActive("agt_missing")).toBeNull();
  });
});

// resolveVerifiedAgentId is exactly the logic POST /api/requests runs to stamp
// verifiedAgentId, so testing it here covers that route branch end-to-end.
describe("resolveVerifiedAgentId", () => {
  it("resolves a fresh agent Bearer token to its agent id", async () => {
    const { agent } = await createAgent("ci");
    const token = await signAgentToken(agent.id, authConfig());
    expect(await resolveVerifiedAgentId({ agentToken: token }, "dual")).toBe(agent.id);
  });

  it("token takes precedence over legacy X-Agent-Id/Secret headers", async () => {
    const a = await createAgent("a");
    const b = await createAgent("b");
    const tokenA = await signAgentToken(a.agent.id, authConfig());
    const resolved = await resolveVerifiedAgentId(
      { agentToken: tokenA, agentId: b.agent.id, agentSecret: b.secret },
      "dual",
    );
    expect(resolved).toBe(a.agent.id);
  });

  it("falls back to legacy header creds when the token is for a revoked agent", async () => {
    const tokenAgent = await createAgent("tok");
    const legacyAgent = await createAgent("leg");
    const token = await signAgentToken(tokenAgent.agent.id, authConfig());
    await revokeAgent(tokenAgent.agent.id); // token signature valid, but agent revoked
    const resolved = await resolveVerifiedAgentId(
      { agentToken: token, agentId: legacyAgent.agent.id, agentSecret: legacyAgent.secret },
      "dual",
    );
    expect(resolved).toBe(legacyAgent.agent.id);
  });

  it("returns null for a revoked-agent token with no legacy fallback", async () => {
    const { agent } = await createAgent("ci");
    const token = await signAgentToken(agent.id, authConfig());
    await revokeAgent(agent.id);
    expect(await resolveVerifiedAgentId({ agentToken: token }, "dual")).toBeNull();
  });

  it("ignores a USER token in the X-Agent-Token slot (no cross-over)", async () => {
    const userTok = await signAccessToken(
      { sub: "user_1", tid: "default", role: "admin", email: "u@x.io" },
      authConfig(),
    );
    expect(await resolveVerifiedAgentId({ agentToken: userTok }, "dual")).toBeNull();
  });

  it("ignores a valid token in api-key-only mode (forgery gate)", async () => {
    const { agent } = await createAgent("ci");
    const token = await signAgentToken(agent.id, authConfig());
    // token would otherwise resolve, but the mode disables the token path
    expect(await resolveVerifiedAgentId({ agentToken: token }, "api-key-only")).toBeNull();
  });

  it("resolves legacy header creds when no token is present", async () => {
    const { agent, secret } = await createAgent("ci");
    expect(
      await resolveVerifiedAgentId({ agentId: agent.id, agentSecret: secret }, "dual"),
    ).toBe(agent.id);
  });

  it("returns null when nothing is presented", async () => {
    expect(await resolveVerifiedAgentId({}, "dual")).toBeNull();
  });
});
