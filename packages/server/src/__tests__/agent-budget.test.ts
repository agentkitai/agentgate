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
  last_seen_at integer, revoked_at integer, monthly_budget_usd real, ingest_key_hash text
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
  vi.useRealTimers();
  resetConfig();
});

/** Stub fetch to return a per-agent spend from a mutable cell, so a test can
 *  change the upstream value between reads. */
function mutableSpend(agentId: string, cell: { usd: number }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ spend: [{ agentId, totalCostUsd: cell.usd, lastEventAt: null }] }),
    }) as Response),
  );
}

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

  it("force-refreshes a stale near-cap read before deciding (#23)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z")); // 30s-aligned cache bucket
    const { agent } = await createAgent("ci", null, 100);
    const cell = { usd: 85 }; // 85% — in the danger zone, under cap
    mutableSpend(agent.id, cell);
    expect((await checkAgentBudget(agent.id, "default")).allowed).toBe(true);

    cell.usd = 120; // jumps over cap; cached 85 is now stale
    vi.advanceTimersByTime(5000); // 5s: within the 30s cache, past the 2s near-cap budget
    const v = await checkAgentBudget(agent.id, "default");
    expect(v.spentUsd).toBe(120); // re-read fresh, not the stale 85
    expect(v.allowed).toBe(false);
  });

  it("keeps serving cache when well under the cap (no near-cap refresh) (#23)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
    const { agent } = await createAgent("ci", null, 100);
    const cell = { usd: 40 }; // 40% — far from cap
    mutableSpend(agent.id, cell);
    expect((await checkAgentBudget(agent.id, "default")).spentUsd).toBe(40);

    cell.usd = 200; // would deny IF we refreshed
    vi.advanceTimersByTime(5000);
    const v = await checkAgentBudget(agent.id, "default");
    expect(v.spentUsd).toBe(40); // stale cache served — far-from-cap agents skip the refresh
    expect(v.allowed).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // only the initial read
  });

  it("keeps a confirmed-over-cap verdict when the near-cap re-read fails (no fail-open) (#23)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
    const { agent } = await createAgent("ci", null, 100);
    mockSpend({ [agent.id]: 105 }); // over cap; warms the cache
    expect((await checkAgentBudget(agent.id, "default")).allowed).toBe(false);

    // 5s later the cache is stale (>2s near-cap budget); make the re-read error.
    vi.advanceTimersByTime(5000);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "" }) as Response));
    const v = await checkAgentBudget(agent.id, "default");
    expect(v.spentUsd).toBe(105); // fell back to the first read's valid value...
    expect(v.allowed).toBe(false); // ...and still DENIES — does not fail open
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
