/**
 * Identity-scoped learned auto-approve suggestions (#45).
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import * as schema from "../db/schema.js";

const { approvalRequests } = schema;

const sqlite = new Database(":memory:");
const db = drizzle(sqlite, { schema });

sqlite.exec(`CREATE TABLE IF NOT EXISTS approval_requests (
  id text PRIMARY KEY NOT NULL, action text NOT NULL, params text, context text,
  status text NOT NULL, urgency text NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL,
  decided_at integer, decided_by text, decision_reason text, expires_at integer, verified_agent_id text
)`);

vi.mock("../db/index.js", () => ({
  getDb: () => db,
  approvalRequests: schema.approvalRequests,
}));

import { computeAutoApproveSuggestions } from "../lib/auto-approve-suggestions.js";

afterAll(() => sqlite.close());

async function seed(opts: {
  agent: string | null;
  action: string;
  status: "approved" | "denied" | "pending";
  ageDays?: number;
}) {
  const decidedAt = opts.status === "pending" ? null : new Date(Date.now() - (opts.ageDays ?? 1) * 86400_000);
  await db.insert(approvalRequests).values({
    id: nanoid(),
    action: opts.action,
    status: opts.status,
    urgency: "normal",
    createdAt: new Date(),
    updatedAt: new Date(),
    decidedAt,
    verifiedAgentId: opts.agent,
  });
}

describe("auto-approve suggestions (#45)", () => {
  beforeEach(() => sqlite.exec("DELETE FROM approval_requests"));

  it("suggests an (agent, action) with >= minApprovals approvals and 0 denials", async () => {
    for (let i = 0; i < 6; i++) await seed({ agent: "agt_a", action: "deploy", status: "approved" });
    const s = await computeAutoApproveSuggestions();
    expect(s).toHaveLength(1);
    expect(s[0]!.verifiedAgentId).toBe("agt_a");
    expect(s[0]!.action).toBe("deploy");
    expect(s[0]!.approvals).toBe(6);
    expect(s[0]!.lastApprovedAt).toBeTypeOf("number");
  });

  it("excludes pairs with ANY denial", async () => {
    for (let i = 0; i < 6; i++) await seed({ agent: "agt_a", action: "deploy", status: "approved" });
    await seed({ agent: "agt_a", action: "deploy", status: "denied" });
    expect(await computeAutoApproveSuggestions()).toHaveLength(0);
  });

  it("excludes pairs below the approval threshold", async () => {
    for (let i = 0; i < 3; i++) await seed({ agent: "agt_a", action: "deploy", status: "approved" });
    expect(await computeAutoApproveSuggestions()).toHaveLength(0);
    expect(await computeAutoApproveSuggestions({ minApprovals: 3 })).toHaveLength(1);
  });

  it("is identity-scoped: ignores null agents and honors the agentId filter", async () => {
    for (let i = 0; i < 6; i++) await seed({ agent: null, action: "deploy", status: "approved" });
    for (let i = 0; i < 6; i++) await seed({ agent: "agt_b", action: "ship", status: "approved" });
    expect(await computeAutoApproveSuggestions()).toHaveLength(1); // null agent ignored
    expect(await computeAutoApproveSuggestions({ agentId: "agt_b" })).toHaveLength(1);
    expect(await computeAutoApproveSuggestions({ agentId: "agt_missing" })).toHaveLength(0);
  });

  it("excludes approvals outside the look-back window", async () => {
    for (let i = 0; i < 6; i++) await seed({ agent: "agt_a", action: "deploy", status: "approved", ageDays: 90 });
    expect(await computeAutoApproveSuggestions({ windowDays: 30 })).toHaveLength(0);
    expect(await computeAutoApproveSuggestions({ windowDays: 120 })).toHaveLength(1);
  });
});
