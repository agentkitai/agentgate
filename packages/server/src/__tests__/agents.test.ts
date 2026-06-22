/**
 * Agent identity registry (agent-identity spine) — lib/agents.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
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
  monthly_budget_usd real
);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
`);

vi.mock("../db/index.js", () => ({ getDb: () => db }));

import {
  createAgent,
  verifyAgentCredential,
  listAgents,
  revokeAgent,
} from "../lib/agents.js";

describe("agent identity registry", () => {
  beforeEach(() => {
    sqlite.exec("DELETE FROM agents");
  });

  it("issues an agt_/ags_ credential and never returns the secret hash", async () => {
    const { agent, secret } = await createAgent("ci-bot");
    expect(agent.id).toMatch(/^agt_/);
    expect(secret).toMatch(/^ags_/);
    expect(agent.status).toBe("active");
    expect((agent as Record<string, unknown>).secretHash).toBeUndefined();
  });

  it("verifies the correct credential and rejects bad ones", async () => {
    const { agent, secret } = await createAgent("ci-bot");
    expect((await verifyAgentCredential(agent.id, secret))?.id).toBe(agent.id);
    expect(await verifyAgentCredential(agent.id, "ags_wrong")).toBeNull();
    expect(await verifyAgentCredential("agt_does_not_exist", secret)).toBeNull();
    expect(await verifyAgentCredential(undefined, undefined)).toBeNull();
  });

  it("stops verifying after revoke and is idempotent", async () => {
    const { agent, secret } = await createAgent("ci-bot");
    expect(await revokeAgent(agent.id)).toBe(true);
    expect(await verifyAgentCredential(agent.id, secret)).toBeNull();
    expect(await revokeAgent(agent.id)).toBe(false); // already revoked
    const listed = await listAgents();
    expect(listed.find((a) => a.id === agent.id)?.status).toBe("revoked");
  });
});
