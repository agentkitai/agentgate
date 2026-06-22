/**
 * Per-agent policy scoping (issue #13) — route validation + cache parsing.
 * The engine-level scope filtering is covered in packages/core policy-engine.test.ts.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { Hono } from "hono";
import * as schema from "../db/schema.js";

const sqlite = new Database(":memory:");
const db = drizzle(sqlite, { schema });

// scope is intentionally nullable here (no NOT NULL) to model a pre-migration
// "legacy" DB row, so the cache's null→global coalesce is genuinely exercised.
sqlite.exec(`
CREATE TABLE IF NOT EXISTS policies (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  rules text NOT NULL,
  priority integer NOT NULL,
  enabled integer NOT NULL,
  scope text,
  agent_ids text,
  tool_ids text,
  created_at integer NOT NULL
);
`);

vi.mock("../db/index.js", async () => ({
  ...(await vi.importActual<typeof import("../db/schema.js")>("../db/schema.js")),
  getDb: () => db,
}));

import policiesRouter from "../routes/policies.js";
import { getCachedPolicies, invalidatePolicyCache } from "../lib/policy-cache.js";

function app() {
  const a = new Hono();
  a.route("/api/policies", policiesRouter);
  return a;
}

function postPolicy(body: Record<string, unknown>) {
  return app().request("/api/policies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const oneRule = [{ match: { action: "send_email" }, decision: "auto_deny" }];

beforeEach(() => {
  sqlite.exec("DELETE FROM policies");
  invalidatePolicyCache();
});

afterAll(() => sqlite.close());

describe("POST /api/policies — scope validation", () => {
  it("creates a per_agent policy and echoes scope + agentIds", async () => {
    const res = await postPolicy({ name: "p", rules: oneRule, scope: "per_agent", agentIds: ["agt_1", "agt_2"] });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.scope).toBe("per_agent");
    expect(body.agentIds).toEqual(["agt_1", "agt_2"]);
    expect(body.toolIds).toBeNull();
  });

  it("defaults scope to global when omitted (backward compatible)", async () => {
    const res = await postPolicy({ name: "p", rules: oneRule });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.scope).toBe("global");
    expect(body.agentIds).toBeNull();
  });

  it("rejects per_agent with no agentIds (misconfig, not silently global)", async () => {
    expect((await postPolicy({ name: "p", rules: oneRule, scope: "per_agent" })).status).toBe(400);
    expect((await postPolicy({ name: "p", rules: oneRule, scope: "per_agent", agentIds: [] })).status).toBe(400);
  });

  it("rejects per_tool with no toolIds", async () => {
    expect((await postPolicy({ name: "p", rules: oneRule, scope: "per_tool" })).status).toBe(400);
  });

  it("rejects an unknown scope and non-string-array ids", async () => {
    expect((await postPolicy({ name: "p", rules: oneRule, scope: "bogus" })).status).toBe(400);
    expect((await postPolicy({ name: "p", rules: oneRule, scope: "per_agent", agentIds: [1, 2] })).status).toBe(400);
  });
});

describe("policy cache parsing", () => {
  it("parses agent_ids JSON and coalesces a NULL legacy scope to global", async () => {
    // A per_agent row (as the route would write it) and a legacy row with NULL scope.
    sqlite
      .prepare("INSERT INTO policies (id, name, rules, priority, enabled, scope, agent_ids, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("p1", "scoped", JSON.stringify(oneRule), 1, 1, "per_agent", JSON.stringify(["agt_1"]), 0);
    sqlite
      .prepare("INSERT INTO policies (id, name, rules, priority, enabled, scope, created_at) VALUES (?,?,?,?,?,NULL,?)")
      .run("p2", "legacy", JSON.stringify(oneRule), 2, 1, 0);

    const cached = await getCachedPolicies();
    const p1 = cached.find((p) => p.id === "p1");
    const p2 = cached.find((p) => p.id === "p2");
    expect(p1?.scope).toBe("per_agent");
    expect(p1?.agentIds).toEqual(["agt_1"]);
    expect(p2?.scope).toBe("global"); // null → global
    expect(p2?.agentIds).toBeUndefined();
  });
});
