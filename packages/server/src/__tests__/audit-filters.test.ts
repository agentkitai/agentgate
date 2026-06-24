/**
 * #22: GET /api/audit verifiedAgentId + decidedByType filters.
 *
 * Drives the REAL auditRouter against a real in-memory DB (only getDb/getDialect
 * are redirected) — the existing audit-api.test.ts uses a mock route, so it
 * doesn't exercise the new filters.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { Hono } from "hono";
import { createTestDb } from "./setup.js";

const ctx = createTestDb();

vi.mock("../db/index.js", async () => {
  const schema = await import("../db/schema.js");
  return { ...schema, getDb: () => ctx.db, getDialect: () => "sqlite" as const };
});

import auditRouter from "../routes/audit.js";
import { approvalRequests, auditLogs } from "../db/schema.js";

function app() {
  const a = new Hono();
  a.route("/api/audit", auditRouter);
  return a;
}

const now = new Date();

async function seed() {
  await ctx.db.insert(approvalRequests).values([
    { id: "req-a", action: "deploy", status: "approved", urgency: "normal", createdAt: now, updatedAt: now, verifiedAgentId: "agt_alpha" },
    { id: "req-b", action: "delete", status: "denied", urgency: "high", createdAt: now, updatedAt: now, verifiedAgentId: "agt_beta" },
  ]);
  await ctx.db.insert(auditLogs).values([
    { id: "au-1", requestId: "req-a", eventType: "approved", actor: "system", details: JSON.stringify({ decidedByType: "policy" }), createdAt: now },
    { id: "au-2", requestId: "req-b", eventType: "denied", actor: "system", details: JSON.stringify({ decidedByType: "override" }), createdAt: now },
    { id: "au-3", requestId: "req-a", eventType: "created", actor: "system", details: JSON.stringify({ verifiedAgentId: "agt_alpha" }), createdAt: now },
  ]);
}

beforeEach(async () => {
  ctx.sqlite.exec("DELETE FROM audit_logs; DELETE FROM approval_requests;");
  await seed();
});
afterAll(() => ctx.cleanup());

interface AuditEntry { id: string }

describe("GET /api/audit filters (#22)", () => {
  it("filters by verifiedAgentId via the approvalRequests join", async () => {
    const res = await app().request("/api/audit?verifiedAgentId=agt_alpha");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: AuditEntry[] };
    expect(body.entries.map((e) => e.id).sort()).toEqual(["au-1", "au-3"]);
  });

  it("filters by decidedByType via the details JSON", async () => {
    const res = await app().request("/api/audit?decidedByType=override");
    const body = (await res.json()) as { entries: AuditEntry[] };
    expect(body.entries.map((e) => e.id)).toEqual(["au-2"]);
  });

  it("ignores an unknown decidedByType value (no filter applied)", async () => {
    const res = await app().request("/api/audit?decidedByType=bogus");
    const body = (await res.json()) as { entries: AuditEntry[] };
    expect(body.entries.length).toBe(3);
  });

  it("combines verifiedAgentId + decidedByType", async () => {
    const res = await app().request("/api/audit?verifiedAgentId=agt_beta&decidedByType=override");
    const body = (await res.json()) as { entries: AuditEntry[] };
    expect(body.entries.map((e) => e.id)).toEqual(["au-2"]);
  });
});
