/**
 * Wiring regression (#24): POST /api/internal/verify-ingest-key must be reachable
 * by its shared-secret caller (AgentLens), i.e. the internal router must be
 * mounted BEFORE the global user-auth middleware. Otherwise the Bearer
 * AGENTGATE_SERVICE_TOKEN is consumed by user-auth (not an agk_ key → invalid
 * JWT → 401) and the endpoint is dead in production. This drives the REAL app
 * from index.ts (authMiddleware active) so a future re-mount regression fails.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createTestDb } from "./setup.js";

const ctx = createTestDb();
vi.mock("../db/index.js", async () => {
  const schema = await import("../db/schema.js");
  return { ...schema, getDb: () => ctx.db };
});

import app from "../index.js";
import { createAgent, rotateIngestKey } from "../lib/agents.js";
import { parseConfig, setConfig, resetConfig } from "../config.js";

const SVC = "svc-wiring-token";
const JWT = "test-jwt-secret-at-least-32-chars-long!!";

const verify = (body: unknown, token: string | null = SVC) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return app.request("/api/internal/verify-ingest-key", { method: "POST", headers, body: JSON.stringify(body) });
};

describe("verify-ingest-key is reachable past the global user-auth middleware", () => {
  beforeEach(() => {
    setConfig(parseConfig({ jwtSecret: JWT, agentgateServiceToken: SVC }));
  });
  afterAll(() => resetConfig());

  it("resolves a valid ingest key with the shared service token (NOT rejected by user-auth)", async () => {
    const { agent } = await createAgent("otlp-bot");
    const key = await rotateIngestKey(agent.id);
    const res = await verify({ ingestKey: key });
    expect(res.status).toBe(200); // reached the internal router — the whole point
    expect((await res.json()).agentId).toBe(agent.id);
  });

  it("still rejects a wrong/missing service token at the router (401, not the user-auth 401)", async () => {
    expect((await verify({ ingestKey: "x" }, "wrong")).status).toBe(401);
    expect((await verify({ ingestKey: "x" }, null)).status).toBe(401);
  });
});
