/**
 * MCP tool-call guardrails (issue #14) — POST /api/mcp/authorize + evaluation.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { nanoid } from "nanoid";
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
CREATE TABLE IF NOT EXISTS approval_requests (
  id text PRIMARY KEY NOT NULL, action text NOT NULL, params text, context text,
  status text NOT NULL, urgency text NOT NULL, created_at integer NOT NULL,
  updated_at integer NOT NULL, decided_at integer, decided_by text,
  decision_reason text, expires_at integer, verified_agent_id text
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY NOT NULL, request_id text NOT NULL, event_type text NOT NULL,
  actor text NOT NULL, details text, created_at integer NOT NULL
);
`);

vi.mock("../db/index.js", async () => ({
  ...(await vi.importActual<typeof import("../db/schema.js")>("../db/schema.js")),
  getDb: () => db,
}));

import { createAgent } from "../lib/agents.js";
import mcpRouter from "../routes/mcp.js";
import { parseConfig, setConfig, resetConfig } from "../config.js";
import { getGlobalEmitter, EventNames } from "@agentgate/core";

const TEST_SECRET = "test-jwt-secret-at-least-32-chars-long!!";

// The api key the MCP server authenticates with — its agentId binding (a #13
// virtual key) is the identity the guardrail keys on. Set per-test.
let boundAgentId: string | null = null;

function app() {
  const a = new Hono();
  a.use("*", async (c, next) => {
    c.set("apiKey", boundAgentId ? ({ id: "k", agentId: boundAgentId } as never) : ({ id: "k", agentId: null } as never));
    await next();
  });
  a.route("/api/mcp", mcpRouter);
  return a;
}

function authorize(toolName: unknown, params: Record<string, unknown> = {}) {
  return app().request("/api/mcp/authorize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ toolName, params }),
  });
}

function addOverride(
  agentId: string,
  toolPattern: string,
  expiresAt: number | null = null,
  action: "require_approval" | "deny" = "require_approval",
) {
  sqlite
    .prepare(
      "INSERT INTO overrides (id, agent_id, tool_pattern, action, reason, created_at, expires_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run(nanoid(), agentId, toolPattern, action, "metric breach", 1, expiresAt);
}

const countRequests = () =>
  (sqlite.prepare("SELECT COUNT(*) n FROM approval_requests").get() as { n: number }).n;

beforeEach(() => {
  sqlite.exec("DELETE FROM agents; DELETE FROM overrides; DELETE FROM approval_requests; DELETE FROM audit_logs;");
  boundAgentId = null;
  setConfig(parseConfig({ jwtSecret: TEST_SECRET })); // authMode = "dual"
});

afterAll(() => {
  resetConfig();
  sqlite.close();
});

describe("POST /api/mcp/authorize", () => {
  it("allows a tool when no override matches (no DB write)", async () => {
    const { agent } = await createAgent("mcp-bot");
    boundAgentId = agent.id;
    const res = await authorize("file.read");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ decision: "allow" });
    expect(countRequests()).toBe(0);
  });

  it("gates a tool when a per-agent override matches → pending approval (acceptance a+b)", async () => {
    const { agent } = await createAgent("mcp-bot");
    boundAgentId = agent.id;
    addOverride(agent.id, "file.*");

    const res = await authorize("file.read", { path: "/etc/passwd" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.decision).toBe("requires_approval");
    expect(body.status).toBe("pending");
    expect(typeof body.requestId).toBe("string");

    const row = sqlite.prepare("SELECT * FROM approval_requests WHERE id = ?").get(body.requestId) as Record<string, unknown>;
    expect(row.action).toBe("file.read");
    expect(row.status).toBe("pending");
    expect(row.verified_agent_id).toBe(agent.id);
  });

  it("respects glob tool patterns", async () => {
    const { agent } = await createAgent("mcp-bot");
    boundAgentId = agent.id;
    addOverride(agent.id, "file.read"); // exact

    expect(((await (await authorize("file.read")).json()) as { decision: string }).decision).toBe("requires_approval");
    expect(((await (await authorize("file.write")).json()) as { decision: string }).decision).toBe("allow");
  });

  it("emits a request.created event so the gated call notifies approvers", async () => {
    const { agent } = await createAgent("mcp-bot");
    boundAgentId = agent.id;
    addOverride(agent.id, "*");

    const events: Array<{ type: string; payload: { requestId?: string; action?: string } }> = [];
    const off = getGlobalEmitter().on(EventNames.REQUEST_CREATED, (e) => {
      events.push(e as (typeof events)[number]);
    });
    try {
      const body = (await (await authorize("send_email", { to: "x@y.io" })).json()) as { requestId: string };
      const ev = events.find((e) => e.payload.requestId === body.requestId);
      expect(ev).toBeDefined();
      expect(ev!.payload.action).toBe("send_email");
    } finally {
      off();
    }
  });

  it("tags the audit trail with OWASP LLM06 (acceptance c)", async () => {
    const { agent } = await createAgent("mcp-bot");
    boundAgentId = agent.id;
    addOverride(agent.id, "*");

    const body = (await (await authorize("dangerous.tool")).json()) as { requestId: string };
    const audit = sqlite.prepare("SELECT * FROM audit_logs WHERE request_id = ?").get(body.requestId) as Record<string, unknown>;
    expect(audit.event_type).toBe("created");
    expect(audit.actor).toBe("mcp");
    const details = JSON.parse(audit.details as string) as Record<string, unknown>;
    expect(details.toolName).toBe("dangerous.tool");
    expect(details.owaspRisk).toBe("LLM06:2025 Excessive Agency");
    expect(details.decision).toBe("requires_approval");
    expect(details.verifiedAgentId).toBe(agent.id);
  });

  it("hard-denies a tool when a deny override matches → synchronous denial + audit (#14)", async () => {
    const { agent } = await createAgent("mcp-bot");
    boundAgentId = agent.id;
    addOverride(agent.id, "fs.*", null, "deny");

    const res = await authorize("fs.delete", { path: "/" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.decision).toBe("deny");
    expect(body.status).toBe("denied");
    expect(typeof body.requestId).toBe("string");

    // A terminal `denied` record exists for the audit trail (not a pending one).
    const row = sqlite.prepare("SELECT * FROM approval_requests WHERE id = ?").get(body.requestId) as Record<string, unknown>;
    expect(row.status).toBe("denied");
    expect(row.decided_by).toBe("override");
    expect(row.verified_agent_id).toBe(agent.id);

    const audit = sqlite.prepare("SELECT * FROM audit_logs WHERE request_id = ?").get(body.requestId) as Record<string, unknown>;
    expect(audit.event_type).toBe("denied");
    const details = JSON.parse(audit.details as string) as Record<string, unknown>;
    expect(details.decision).toBe("deny");
    expect(details.owaspRisk).toBe("LLM06:2025 Excessive Agency");
  });

  it("prefers deny over require_approval when both overrides match (#14)", async () => {
    const { agent } = await createAgent("mcp-bot");
    boundAgentId = agent.id;
    addOverride(agent.id, "*", null, "require_approval");
    addOverride(agent.id, "secret.read", null, "deny");
    const body = (await (await authorize("secret.read")).json()) as { decision: string };
    expect(body.decision).toBe("deny");
  });

  it("does not emit a request.created event for a hard deny (#14)", async () => {
    const { agent } = await createAgent("mcp-bot");
    boundAgentId = agent.id;
    addOverride(agent.id, "*", null, "deny");
    const events: string[] = [];
    const off = getGlobalEmitter().on(EventNames.REQUEST_CREATED, () => events.push("created"));
    try {
      await authorize("anything");
      expect(events).toHaveLength(0);
    } finally {
      off();
    }
  });

  it("allows (fail-open) when no agent identity is presented, even if an override exists", async () => {
    const { agent } = await createAgent("mcp-bot");
    addOverride(agent.id, "*");
    boundAgentId = null; // api key has no virtual-key binding, no X-Agent headers
    const res = await authorize("anything");
    expect(((await res.json()) as { decision: string }).decision).toBe("allow");
    expect(countRequests()).toBe(0);
  });

  it("ignores an expired override", async () => {
    const { agent } = await createAgent("mcp-bot");
    boundAgentId = agent.id;
    addOverride(agent.id, "*", 1); // expiresAt in the past (epoch 1)
    expect(((await (await authorize("file.read")).json()) as { decision: string }).decision).toBe("allow");
  });

  it("rejects a missing toolName", async () => {
    const { agent } = await createAgent("mcp-bot");
    boundAgentId = agent.id;
    expect((await authorize(undefined)).status).toBe(400);
  });

  it("403s when the key binding is to a revoked/unknown agent", async () => {
    boundAgentId = "agt_ghost"; // bound to an agent that isn't in the registry
    const res = await authorize("file.read");
    expect(res.status).toBe(403);
  });
});
