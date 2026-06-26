/**
 * Agent-identity spine end-to-end (#12).
 *
 * Drives the REAL routes against a REAL (in-memory, migrated) database — only
 * getDb() is redirected — to prove the full OAuth2 client-credentials flow:
 *   mint token (POST /api/agents/token) → present X-Agent-Token on
 *   POST /api/requests → the verified agent id is persisted on the approval
 *   request AND stamped into the audit trail.
 * Plus the negative paths: a forged (user) token, a revoked agent, and an
 * expired token must NOT be accepted as a verified agent identity.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { signAccessToken, type AuthConfig } from "@agentkitai/auth";
import { createTestDb } from "./setup.js";

const WRONG_SECRET = "a-totally-different-secret-32-chars-xx";

const ctx = createTestDb();

// Redirect every getDb() in the route chain at the real in-memory DB while
// preserving the module's schema re-exports (routes import tables from here).
vi.mock("../db/index.js", async () => {
  const schema = await import("../db/schema.js");
  return { ...schema, getDb: () => ctx.db };
});

import { createAgent, revokeAgent } from "../lib/agents.js";
import * as agentsLib from "../lib/agents.js";
import { approvalRequests, auditLogs, overrides } from "../db/schema.js";
import agentTokenRouter from "../routes/agent-tokens.js";
import requestsRouter from "../routes/requests.js";
import { createGuardrailsRouter } from "../routes/guardrails.js";
import { parseConfig, setConfig, resetConfig } from "../config.js";
import { invalidatePolicyCache } from "../lib/policy-cache.js";

const TEST_SECRET = "test-jwt-secret-at-least-32-chars-long!!";

function jwtConfig(ttlSeconds = 900, secret = TEST_SECRET): AuthConfig {
  return {
    oidc: null,
    jwt: { secret, accessTokenTtlSeconds: ttlSeconds, refreshTokenTtlSeconds: 604800 },
    authDisabled: false,
  };
}

/** Decode a JWT's payload without verifying it (test introspection only). */
function decodeJwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
}

function makeApp() {
  const app = new Hono();
  app.route("/api/agents/token", agentTokenRouter);
  app.route("/api/requests", requestsRouter);
  app.route(
    "/api/guardrails",
    createGuardrailsRouter({
      secret: "wh-secret",
      rules: [{ metric: "error_rate", toolPattern: "*", ttlSeconds: 3600 }],
    }),
  );
  return app;
}

async function mintToken(app: Hono, clientId: string, secret: string): Promise<string> {
  const res = await app.request("/api/agents/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: clientId, client_secret: secret }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function createRequest(app: Hono, headers: Record<string, string>): Promise<string> {
  const res = await app.request("/api/requests", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    // A deliberately different caller-claimed context.agentId proves the
    // VERIFIED id is independent of the unauthenticated claim.
    body: JSON.stringify({ action: "deploy_production", context: { agentId: "claimed-imposter" } }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function verifiedAgentIdOf(requestId: string): Promise<string | null> {
  const rows = await ctx.db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
  return rows[0]?.verifiedAgentId ?? null;
}

beforeEach(() => {
  // Children before parents (audit_logs FK → approval_requests).
  ctx.sqlite.exec(
    "DELETE FROM audit_logs; DELETE FROM approval_requests; DELETE FROM agents; DELETE FROM overrides; DELETE FROM policies;",
  );
  setConfig(parseConfig({ jwtSecret: TEST_SECRET })); // authMode defaults to "dual"
  invalidatePolicyCache();
});

afterAll(() => {
  resetConfig();
  ctx.cleanup();
});

describe("agent-identity e2e: OAuth2 → approval → audit", () => {
  it("stamps the verified agent id on the request AND the audit trail", async () => {
    const app = makeApp();
    const { agent, secret } = await createAgent("ci-agent");

    const token = await mintToken(app, agent.id, secret);
    const requestId = await createRequest(app, { "x-agent-token": token });

    // Persisted on the approval request, not the caller's claimed id.
    expect(await verifiedAgentIdOf(requestId)).toBe(agent.id);

    // Stamped into the audit trail as cryptographic evidence of who made it.
    const audit = await ctx.db.select().from(auditLogs).where(eq(auditLogs.requestId, requestId));
    const created = audit.find((a) => a.eventType === "created");
    expect(created).toBeDefined();
    expect(JSON.parse(created!.details!).verifiedAgentId).toBe(agent.id);
  });

  it("rejects a forged user token (no typ:agent) even for a registered agent id", async () => {
    const app = makeApp();
    // The token's sub IS a real, active agent — so the ONLY thing that can
    // reject it is the missing typ:"agent" claim (the cross-over guard), not
    // the agent being absent from the registry.
    const { agent } = await createAgent("crossover-agent");
    const userToken = await signAccessToken(
      { sub: agent.id, tid: "default", role: "admin", email: "a@x.io" },
      jwtConfig(),
    );
    const requestId = await createRequest(app, { "x-agent-token": userToken });
    expect(await verifiedAgentIdOf(requestId)).toBeNull();
  });

  it("rejects a token signed with the wrong key (signature is load-bearing)", async () => {
    const app = makeApp();
    // A real, active agent + a valid typ:"agent" claim, but signed with a key
    // the server does not trust → only the signature check can reject it.
    const { agent } = await createAgent("sig-agent");
    const forged = await signAccessToken(
      { sub: agent.id, tid: "default", role: "viewer", email: "", typ: "agent" },
      jwtConfig(900, WRONG_SECRET),
    );
    const requestId = await createRequest(app, { "x-agent-token": forged });
    expect(await verifiedAgentIdOf(requestId)).toBeNull();
  });

  it("rejects a revoked agent's still-signed token — no verified id stamped", async () => {
    const app = makeApp();
    const { agent, secret } = await createAgent("rev-agent");
    const token = await mintToken(app, agent.id, secret);
    await revokeAgent(agent.id); // token signature stays valid; use-time check rejects

    const requestId = await createRequest(app, { "x-agent-token": token });
    expect(await verifiedAgentIdOf(requestId)).toBeNull();
  });

  it("rejects an expired token — no verified id stamped", async () => {
    const app = makeApp();
    const { agent } = await createAgent("exp-agent");
    // Negative TTL → exp in the past → verifyAccessToken returns null.
    const expired = await signAccessToken(
      { sub: agent.id, tid: "default", role: "viewer", email: "", typ: "agent" },
      jwtConfig(-10),
    );
    // Confirm the token is genuinely expired (not merely malformed), so the
    // rejection below is provably due to expiry.
    expect(decodeJwtPayload(expired).exp as number).toBeLessThan(Math.floor(Date.now() / 1000));

    const requestId = await createRequest(app, { "x-agent-token": expired });
    expect(await verifiedAgentIdOf(requestId)).toBeNull();
  });
});

describe("guardrails webhook identity (#12)", () => {
  async function postBreach(app: Hono, agentId: string) {
    return app.request("/api/guardrails/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-guardrails-secret": "wh-secret" },
      body: JSON.stringify({ event: "breach", metric: "error_rate", agentId }),
    });
  }

  it("creates an override for a known active agent but ignores an unknown one", async () => {
    const app = makeApp();
    const { agent } = await createAgent("monitored");

    const ok = await postBreach(app, agent.id);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { status: string }).status).toBe("override_created");
    const rows = await ctx.db.select().from(overrides).where(eq(overrides.agentId, agent.id));
    expect(rows).toHaveLength(1);

    const ghost = await postBreach(app, "agt_ghost");
    expect(ghost.status).toBe(200);
    expect(((await ghost.json()) as { status: string }).status).toBe("ignored");
    expect(await ctx.db.select().from(overrides).where(eq(overrides.agentId, "agt_ghost"))).toHaveLength(0);
  });

  it("ignores a breach for a revoked agent", async () => {
    const app = makeApp();
    const { agent } = await createAgent("revoked-monitored");
    await revokeAgent(agent.id);
    const res = await postBreach(app, agent.id);
    expect(((await res.json()) as { status: string }).status).toBe("ignored");
  });

  it("fails OPEN and still applies the override if the registry lookup errors", async () => {
    const app = makeApp();
    const spy = vi.spyOn(agentsLib, "getAgentIfActive").mockRejectedValueOnce(new Error("db down"));
    const res = await postBreach(app, "agt_during_outage");
    expect(((await res.json()) as { status: string }).status).toBe("override_created");
    spy.mockRestore();
  });
});
