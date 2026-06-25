/**
 * Reactive guardrail breach → AgentLens mirror (#55, gate→lens wedge).
 *
 * The webhook handler forwards a breach to AgentLens only when the caller
 * correlated it to a session (body.sessionId). Fire-and-forget + fail-open.
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
CREATE TABLE IF NOT EXISTS overrides (
  id text PRIMARY KEY NOT NULL, agent_id text NOT NULL, tool_pattern text NOT NULL,
  action text NOT NULL, reason text, created_at integer NOT NULL, expires_at integer
);
`);

vi.mock("../db/index.js", async () => ({
  ...(await vi.importActual<typeof import("../db/schema.js")>("../db/schema.js")),
  getDb: () => db,
}));

import { createAgent } from "../lib/agents.js";
import { createGuardrailsRouter } from "../routes/guardrails.js";
import { parseConfig, setConfig, resetConfig } from "../config.js";

const SECRET = "wh-secret";
const RULES = [{ metric: "error_rate", toolPattern: "*", reason: "Error rate high" }];

function app() {
  const a = new Hono();
  a.route("/api/guardrails", createGuardrailsRouter({ secret: SECRET, rules: RULES }));
  return a;
}

function webhook(body: unknown) {
  return app().request("/api/guardrails/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-guardrails-secret": SECRET },
    body: JSON.stringify(body),
  });
}

function fetchMock() {
  const fn = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({}), text: async () => "" }) as Response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  sqlite.exec("DELETE FROM agents; DELETE FROM overrides;");
  setConfig(parseConfig({ agentlensUrl: "https://lens.example", agentgateServiceToken: "svc-token" }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetConfig();
});

describe("reactive breach → AgentLens mirror (#55)", () => {
  it("forwards a breach to AgentLens when the webhook carries a sessionId", async () => {
    const { agent } = await createAgent("bot");
    const fn = fetchMock();

    const res = await webhook({ event: "breach", metric: "error_rate", agentId: agent.id, sessionId: "sess-9" });
    expect(res.status).toBe(200);

    await vi.waitFor(() => expect(fn).toHaveBeenCalled());
    const [url, init] = fn.mock.calls[0]!;
    expect(String(url)).toBe("https://lens.example/api/internal/eval/guardrail-breach");
    expect(JSON.parse((init as { body: string }).body)).toMatchObject({
      sessionId: "sess-9",
      agentId: agent.id,
      breach: { ruleId: "error_rate", source: "reactive_guardrail" },
    });
  });

  it("does NOT call AgentLens when the breach has no sessionId (absent or empty)", async () => {
    const { agent } = await createAgent("bot");
    const fn = fetchMock();

    for (const body of [
      { event: "breach", metric: "error_rate", agentId: agent.id }, // absent
      { event: "breach", metric: "error_rate", agentId: agent.id, sessionId: "" }, // empty
    ]) {
      const res = await webhook(body);
      expect(res.status).toBe(200);
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(fn).not.toHaveBeenCalled();
  });
});
