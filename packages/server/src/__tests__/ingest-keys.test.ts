/**
 * Ingest keys (#24) — a revocable, ingest-scoped agent credential (agl_ingest_*)
 * for OTLP exporters that can't refresh a 15-min token. lib/agents resolution +
 * the internal verify route AgentLens calls.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
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
  monthly_budget_usd real,
  ingest_key_hash text
);
CREATE INDEX IF NOT EXISTS idx_agents_ingest_key ON agents(ingest_key_hash);
`);

const h = vi.hoisted(() => ({ svcToken: "svc-tok" as string | undefined }));
vi.mock("../db/index.js", () => ({ getDb: () => db }));
vi.mock("../config.js", () => ({ getConfig: () => ({ agentgateServiceToken: h.svcToken }) }));

import {
  createAgent,
  rotateIngestKey,
  revokeIngestKey,
  resolveAgentByIngestKey,
  revokeAgent,
  listAgents,
} from "../lib/agents.js";
import internalRouter from "../routes/internal.js";

describe("ingest keys — lib/agents", () => {
  beforeEach(() => {
    sqlite.exec("DELETE FROM agents");
    h.svcToken = "svc-tok";
  });

  it("issues an agl_ingest_* key that resolves back to the agent", async () => {
    const { agent } = await createAgent("otlp-bot");
    const key = await rotateIngestKey(agent.id);
    expect(key).toMatch(/^agl_ingest_/);
    expect(await resolveAgentByIngestKey(key!)).toBe(agent.id);
    // never leaks the hash in the public view
    const listed = await listAgents();
    expect((listed.find((a) => a.id === agent.id) as Record<string, unknown>).ingestKeyHash).toBeUndefined();
  });

  it("rejects a wrong/empty key", async () => {
    const { agent } = await createAgent("otlp-bot");
    await rotateIngestKey(agent.id);
    expect(await resolveAgentByIngestKey("agl_ingest_wrong")).toBeNull();
    expect(await resolveAgentByIngestKey("")).toBeNull();
    expect(await resolveAgentByIngestKey(undefined)).toBeNull();
  });

  it("rotation invalidates the previous key immediately", async () => {
    const { agent } = await createAgent("otlp-bot");
    const k1 = await rotateIngestKey(agent.id);
    const k2 = await rotateIngestKey(agent.id);
    expect(k2).not.toBe(k1);
    expect(await resolveAgentByIngestKey(k1!)).toBeNull(); // old key dead
    expect(await resolveAgentByIngestKey(k2!)).toBe(agent.id);
  });

  it("revoking the ingest key stops resolution but leaves the agent active", async () => {
    const { agent } = await createAgent("otlp-bot");
    const key = await rotateIngestKey(agent.id);
    expect(await revokeIngestKey(agent.id)).toBe(true);
    expect(await resolveAgentByIngestKey(key!)).toBeNull();
    const listed = await listAgents();
    expect(listed.find((a) => a.id === agent.id)?.status).toBe("active"); // agent itself untouched
  });

  it("a revoked AGENT's ingest key no longer resolves", async () => {
    const { agent } = await createAgent("otlp-bot");
    const key = await rotateIngestKey(agent.id);
    await revokeAgent(agent.id);
    expect(await resolveAgentByIngestKey(key!)).toBeNull();
    // and you can't issue a key for a revoked agent
    expect(await rotateIngestKey(agent.id)).toBeNull();
  });

  it("revokeIngestKey on a missing agent returns false", async () => {
    expect(await revokeIngestKey("agt_nope")).toBe(false);
  });
});

describe("POST /api/internal/verify-ingest-key", () => {
  const app = new Hono();
  app.route("/api/internal", internalRouter);

  const call = (body: unknown, token: string | null = "svc-tok") => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return app.request("/api/internal/verify-ingest-key", { method: "POST", headers, body: JSON.stringify(body) });
  };

  beforeEach(() => {
    sqlite.exec("DELETE FROM agents");
    h.svcToken = "svc-tok";
  });

  it("resolves a valid key to its agent id (with the shared service token)", async () => {
    const { agent } = await createAgent("otlp-bot");
    const key = await rotateIngestKey(agent.id);
    const res = await call({ ingestKey: key });
    expect(res.status).toBe(200);
    expect((await res.json()).agentId).toBe(agent.id);
  });

  it("returns agentId null for an invalid/revoked key (so the caller can cache the negative)", async () => {
    const res = await call({ ingestKey: "agl_ingest_nope" });
    expect(res.status).toBe(200);
    expect((await res.json()).agentId).toBeNull();
  });

  it("rejects a missing/wrong service token (401) and validates the body (400)", async () => {
    expect((await call({ ingestKey: "x" }, null)).status).toBe(401);
    expect((await call({ ingestKey: "x" }, "wrong")).status).toBe(401);
    expect((await call({})).status).toBe(400);
  });

  it("returns 503 when the service token is unset (feature disabled)", async () => {
    h.svcToken = undefined;
    expect((await call({ ingestKey: "x" })).status).toBe(503);
  });
});
