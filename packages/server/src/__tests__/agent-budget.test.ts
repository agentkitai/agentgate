/**
 * Per-agent budget enforcement (#13) — checkAgentBudget + admin budget routes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { Hono } from "hono";
import * as schema from "../db/schema.js";

const sqlite = new Database(":memory:");
const db = drizzle(sqlite, { schema });

sqlite.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY NOT NULL, name text NOT NULL, secret_hash text NOT NULL,
  status text NOT NULL, metadata text, created_at integer NOT NULL,
  last_seen_at integer, revoked_at integer, monthly_budget_usd real
);
`);

vi.mock("../db/index.js", async () => ({
  ...(await vi.importActual<typeof import("../db/schema.js")>("../db/schema.js")),
  getDb: () => db,
}));

import { createAgent, getAgentBudget, setAgentBudget } from "../lib/agents.js";
import { checkAgentBudget } from "../lib/agent-budget.js";
import { clearSpendCache } from "../lib/agent-spend.js";
import agentsRouter from "../routes/agents.js";
import { parseConfig, setConfig, resetConfig } from "../config.js";

const LENS = { agentlensUrl: "https://lens.example", agentgateServiceToken: "svc" };

function mockSpend(usdByAgent: Record<string, number>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        spend: Object.entries(usdByAgent).map(([agentId, totalCostUsd]) => ({ agentId, totalCostUsd, lastEventAt: null })),
      }),
    }) as Response),
  );
}

beforeEach(() => {
  sqlite.exec("DELETE FROM agents");
  clearSpendCache();
  setConfig(parseConfig(LENS));
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetConfig();
});

describe("checkAgentBudget", () => {
  it("allows an agent with no budget (limit null)", async () => {
    const { agent } = await createAgent("ci"); // no budget
    mockSpend({ [agent.id]: 999 });
    const v = await checkAgentBudget(agent.id, "default");
    expect(v).toMatchObject({ allowed: true, limitUsd: null });
  });

  it("allows when under budget", async () => {
    const { agent } = await createAgent("ci", null, 100);
    mockSpend({ [agent.id]: 40 });
    const v = await checkAgentBudget(agent.id, "default");
    expect(v.allowed).toBe(true);
    expect(v.spentUsd).toBe(40);
    expect(v.limitUsd).toBe(100);
  });

  it("denies when spend has reached/exceeded the budget", async () => {
    const { agent } = await createAgent("ci", null, 100);
    mockSpend({ [agent.id]: 150 });
    expect((await checkAgentBudget(agent.id, "default")).allowed).toBe(false);
    clearSpendCache();
    mockSpend({ [agent.id]: 100 }); // exactly at limit → denied (spent < limit is false)
    expect((await checkAgentBudget(agent.id, "default")).allowed).toBe(false);
  });

  it("fails OPEN when AgentLens is unconfigured", async () => {
    const { agent } = await createAgent("ci", null, 100);
    setConfig(parseConfig({})); // no AgentLens
    expect((await checkAgentBudget(agent.id, "default")).allowed).toBe(true);
  });

  it("fails OPEN when the spend fetch errors", async () => {
    const { agent } = await createAgent("ci", null, 100);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "" }) as Response));
    expect((await checkAgentBudget(agent.id, "default")).allowed).toBe(true);
  });
});

describe("agent budget storage + admin routes", () => {
  function app() {
    const a = new Hono();
    a.use("*", async (c, next) => {
      c.set("auth", { identity: { type: "api_key" }, tenantId: "default", permissions: ["*"] } as never);
      await next();
    });
    a.route("/api/agents", agentsRouter);
    return a;
  }

  it("createAgent persists a budget; getAgentBudget reads it", async () => {
    const { agent } = await createAgent("ci", null, 250.5);
    expect(await getAgentBudget(agent.id)).toBe(250.5);
  });

  it("setAgentBudget sets and clears; returns false for a missing agent", async () => {
    const { agent } = await createAgent("ci");
    expect(await setAgentBudget(agent.id, 50)).toBe(true);
    expect(await getAgentBudget(agent.id)).toBe(50);
    expect(await setAgentBudget(agent.id, null)).toBe(true);
    expect(await getAgentBudget(agent.id)).toBeNull();
    expect(await setAgentBudget("agt_missing", 10)).toBe(false);
  });

  it("PATCH /api/agents/:id/budget updates the cap", async () => {
    const { agent } = await createAgent("ci");
    const res = await app().request(`/api/agents/${agent.id}/budget`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ monthlyBudgetUsd: 75 }),
    });
    expect(res.status).toBe(200);
    expect(await getAgentBudget(agent.id)).toBe(75);
  });

  it("PATCH on a missing agent → 404", async () => {
    const res = await app().request("/api/agents/agt_nope/budget", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ monthlyBudgetUsd: 10 }),
    });
    expect(res.status).toBe(404);
  });
});
