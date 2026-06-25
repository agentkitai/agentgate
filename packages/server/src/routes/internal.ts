// @agentgate/server — Internal service-to-service routes (#24).
//
// POST /api/internal/verify-ingest-key — AgentLens calls this to resolve the
// verified agent id for an OTLP ingest key it received. Authenticated by the
// SHARED AGENTGATE_SERVICE_TOKEN bearer (the same secret AgentGate presents to
// AgentLens's /api/internal/spend — it's a bidirectional service secret), NOT a
// user/api-key. AgentLens caches the result briefly, so a revoked/rotated key
// stops resolving almost immediately. Never returns the key or any secret.

import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { getConfig } from "../config.js";
import { resolveAgentByIngestKey } from "../lib/agents.js";

const router = new Hono();

/** Constant-time bearer check against the shared service token. */
function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Service-token auth for every /api/internal route.
router.use("*", async (c, next) => {
  const expected = getConfig().agentgateServiceToken;
  if (!expected) {
    return c.json({ error: "Internal endpoints disabled (AGENTGATE_SERVICE_TOKEN unset)" }, 503);
  }
  const authHeader = c.req.header("Authorization");
  const presented = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!presented || !tokenMatches(presented, expected)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

const verifyIngestKeySchema = z.object({ ingestKey: z.string().min(1) });

// Resolve an ingest key → { agentId } (null when invalid/revoked/rotated).
router.post("/verify-ingest-key", zValidator("json", verifyIngestKeySchema), async (c) => {
  const { ingestKey } = c.req.valid("json");
  const agentId = await resolveAgentByIngestKey(ingestKey);
  return c.json({ agentId });
});

export default router;
