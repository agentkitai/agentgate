/**
 * Virtual keys — agent-scoped API keys (issue #13, PR1).
 *
 * reconcileBoundAgent (pure) is the enforcement decision POST /api/requests
 * runs; the route tests cover issuance + the getAgentIfActive binding gate.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { Hono } from "hono";
import * as schema from "../db/schema.js";

const sqlite = new Database(":memory:");
const db = drizzle(sqlite, { schema });

sqlite.exec(`
CREATE TABLE IF NOT EXISTS api_keys (
  id text PRIMARY KEY NOT NULL,
  key_hash text NOT NULL,
  name text NOT NULL,
  scopes text NOT NULL,
  created_at integer NOT NULL,
  last_used_at integer,
  revoked_at integer,
  rate_limit integer,
  agent_id text
);
CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  secret_hash text NOT NULL,
  status text NOT NULL,
  metadata text,
  created_at integer NOT NULL,
  last_seen_at integer,
  revoked_at integer
);
`);

// db/index re-exports the schema tables (lib/api-keys imports `apiKeys` from
// here), so the mock must surface them alongside getDb.
vi.mock("../db/index.js", async () => ({
  ...(await vi.importActual<typeof import("../db/schema.js")>("../db/schema.js")),
  getDb: () => db,
}));

import { createAgent, revokeAgent } from "../lib/agents.js";
import { reconcileBoundAgent, resolveEffectiveAgentId } from "../lib/agent-tokens.js";
import apiKeysRouter from "../routes/api-keys.js";

function app() {
  const a = new Hono();
  // Stub the admin auth that requirePermission("keys:manage") checks.
  a.use("*", async (c, next) => {
    c.set("auth", {
      identity: { type: "api_key", id: "k", displayName: "test", role: "admin" },
      tenantId: "default",
      permissions: ["*"],
    });
    await next();
  });
  a.route("/api/api-keys", apiKeysRouter);
  return a;
}

function createKey(body: Record<string, unknown>) {
  return app().request("/api/api-keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function persistedAgentId(keyId: string): unknown {
  return (sqlite.prepare("SELECT agent_id FROM api_keys WHERE id = ?").get(keyId) as
    | { agent_id: unknown }
    | undefined)?.agent_id;
}

beforeEach(() => {
  sqlite.exec("DELETE FROM api_keys");
  sqlite.exec("DELETE FROM agents");
});

afterAll(() => sqlite.close());

describe("reconcileBoundAgent", () => {
  it("passes the verified id through for an unbound (legacy) key", () => {
    expect(reconcileBoundAgent(null, null)).toEqual({ agentId: null });
    expect(reconcileBoundAgent(null, "agt_x")).toEqual({ agentId: "agt_x" });
  });
  it("promotes the binding to verified when there is no separate claim", () => {
    expect(reconcileBoundAgent("agt_x", null)).toEqual({ agentId: "agt_x" });
  });
  it("accepts a matching separate claim", () => {
    expect(reconcileBoundAgent("agt_x", "agt_x")).toEqual({ agentId: "agt_x" });
  });
  it("conflicts when the verified claim names a different agent", () => {
    expect(reconcileBoundAgent("agt_x", "agt_y")).toEqual({ conflict: true });
  });
});

// resolveEffectiveAgentId is exactly the binding resolution POST /api/requests
// runs (reconcile + use-time liveness recheck), so testing it covers that route
// branch including the revoked-binding case.
describe("resolveEffectiveAgentId", () => {
  it("passes the verified id through for an unbound (legacy) key", async () => {
    expect(await resolveEffectiveAgentId(null, "agt_x")).toEqual({ agentId: "agt_x" });
    expect(await resolveEffectiveAgentId(null, null)).toEqual({ agentId: null });
  });

  it("promotes an active binding (with or without a matching claim)", async () => {
    const { agent } = await createAgent("ci");
    expect(await resolveEffectiveAgentId(agent.id, null)).toEqual({ agentId: agent.id });
    expect(await resolveEffectiveAgentId(agent.id, agent.id)).toEqual({ agentId: agent.id });
  });

  it("rejects a binding whose agent has been revoked (use-time recheck)", async () => {
    const { agent } = await createAgent("ci");
    await revokeAgent(agent.id);
    expect(await resolveEffectiveAgentId(agent.id, null)).toEqual({ reject: "revoked_binding" });
  });

  it("rejects a binding to an unknown agent", async () => {
    expect(await resolveEffectiveAgentId("agt_ghost", null)).toEqual({ reject: "revoked_binding" });
  });

  it("rejects a conflict before checking liveness", async () => {
    const { agent } = await createAgent("ci");
    expect(await resolveEffectiveAgentId(agent.id, "agt_other")).toEqual({ reject: "conflict" });
  });
});

describe("POST /api/api-keys — virtual key issuance", () => {
  it("issues a key bound to an active agent and echoes + persists agentId", async () => {
    const { agent } = await createAgent("ci");
    const res = await createKey({ name: "vk", scopes: ["admin"], agentId: agent.id });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.key).toMatch(/^agk_/);
    expect(body.agentId).toBe(agent.id);
    expect(persistedAgentId(body.id as string)).toBe(agent.id);
  });

  it("rejects binding to a nonexistent agent", async () => {
    const res = await createKey({ name: "vk", scopes: ["admin"], agentId: "agt_nope" });
    expect(res.status).toBe(400);
  });

  it("rejects binding to a revoked agent", async () => {
    const { agent } = await createAgent("ci");
    await revokeAgent(agent.id);
    const res = await createKey({ name: "vk", scopes: ["admin"], agentId: agent.id });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed agentId (zod)", async () => {
    const res = await createKey({ name: "vk", scopes: ["admin"], agentId: "not-an-agent" });
    expect(res.status).toBe(400);
  });

  it("issues an unbound legacy key when agentId is omitted", async () => {
    const res = await createKey({ name: "legacy", scopes: ["admin"] });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.agentId).toBeNull();
    expect(persistedAgentId(body.id as string)).toBeNull();
  });

  it("surfaces agentId in the list endpoint", async () => {
    const { agent } = await createAgent("ci");
    const created = (await (await createKey({ name: "vk", scopes: ["admin"], agentId: agent.id })).json()) as {
      id: string;
    };
    const listRes = await app().request("/api/api-keys");
    expect(listRes.status).toBe(200);
    const { keys } = (await listRes.json()) as { keys: Array<{ id: string; agentId: unknown }> };
    expect(keys.find((k) => k.id === created.id)?.agentId).toBe(agent.id);
  });
});
