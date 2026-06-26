/**
 * Escalation fallback decision (#44) — a `decision:*` escalation rule resolves a
 * request that no human ever answers, instead of leaving it pending forever.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "../db/schema.js";

const { approvalRequests, escalationRules, escalationHistory } = schema;

const sqlite = new Database(":memory:");
const db = drizzle(sqlite, { schema });

const MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS approval_requests (id text PRIMARY KEY NOT NULL, action text NOT NULL, params text, context text, status text NOT NULL, urgency text NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, decided_at integer, decided_by text, decision_reason text, expires_at integer, verified_agent_id text);
CREATE TABLE IF NOT EXISTS escalation_rules (id text PRIMARY KEY NOT NULL, policy_id text, trigger_after_sec integer NOT NULL DEFAULT 1800, escalate_to text NOT NULL, priority integer NOT NULL DEFAULT 0, enabled integer NOT NULL DEFAULT 1, created_at integer NOT NULL);
CREATE TABLE IF NOT EXISTS escalation_history (id text PRIMARY KEY NOT NULL, request_id text NOT NULL, rule_id text NOT NULL, escalated_at integer NOT NULL, from_channel text, to_channel text NOT NULL);
`;
for (const stmt of MIGRATIONS_SQL.split(";")) {
  const t = stmt.trim();
  if (t) sqlite.exec(t);
}

vi.mock("../db/index.js", () => ({
  getDb: () => db,
  approvalRequests: schema.approvalRequests,
  escalationRules: schema.escalationRules,
  escalationHistory: schema.escalationHistory,
}));
vi.mock("../lib/webhook.js", () => ({ deliverWebhook: vi.fn() }));
vi.mock("../lib/audit.js", () => ({ logAuditEvent: vi.fn() }));
vi.mock("../lib/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

import { scanPendingEscalations } from "../lib/escalation.js";

afterAll(() => sqlite.close());

async function seedPending(ageSec: number): Promise<string> {
  const id = nanoid();
  await db.insert(approvalRequests).values({
    id, action: "deploy", status: "pending", urgency: "normal",
    createdAt: new Date(Date.now() - ageSec * 1000), updatedAt: new Date(),
  });
  return id;
}

async function seedRule(escalateTo: string, triggerAfterSec = 60, priority = 0): Promise<void> {
  await db.insert(escalationRules).values({
    id: nanoid(), policyId: null, triggerAfterSec, escalateTo, priority, enabled: 1,
    createdAt: Math.floor(Date.now() / 1000),
  });
}

async function statusOf(id: string): Promise<{ status: string; decidedBy: string | null }> {
  const [r] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, id));
  return { status: r.status, decidedBy: r.decidedBy };
}

describe("escalation fallback decision (#44)", () => {
  beforeEach(() => {
    sqlite.exec("DELETE FROM escalation_history");
    sqlite.exec("DELETE FROM escalation_rules");
    sqlite.exec("DELETE FROM approval_requests");
  });

  it("auto-denies a timed-out request via a decision:deny rule", async () => {
    const reqId = await seedPending(7200); // 2h old
    await seedRule("decision:deny", 60);
    const n = await scanPendingEscalations();
    expect(n).toBe(1);
    const r = await statusOf(reqId);
    expect(r.status).toBe("denied");
    expect(r.decidedBy).toBe("escalation_fallback");
    const hist = await db.select().from(escalationHistory).where(eq(escalationHistory.requestId, reqId));
    expect(hist.length).toBe(1);
  });

  it("auto-approves via a decision:approve rule", async () => {
    const reqId = await seedPending(7200);
    await seedRule("decision:approve", 60);
    await scanPendingEscalations();
    expect((await statusOf(reqId)).status).toBe("approved");
  });

  it("leaves a request pending until its timeout elapses", async () => {
    const reqId = await seedPending(10); // 10s old
    await seedRule("decision:deny", 3600); // 1h threshold
    await scanPendingEscalations();
    expect((await statusOf(reqId)).status).toBe("pending");
  });

  it("a channel rule notifies but does NOT decide (no fallback)", async () => {
    const reqId = await seedPending(7200);
    await seedRule("slack:#escalation", 60);
    await scanPendingEscalations();
    expect((await statusOf(reqId)).status).toBe("pending");
  });
});
