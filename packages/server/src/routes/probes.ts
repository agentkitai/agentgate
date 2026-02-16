/**
 * Kubernetes-style readiness and startup probes for AgentGate.
 *
 * GET /ready   — checks DB + Redis (if configured). Returns 200 or 503.
 * GET /startup — checks that DB migrations have been applied. Returns 200 or 503.
 */

import { Hono } from "hono";
import { getDb } from "../db/index.js";
import { getConfig } from "../config.js";
import { getRateLimiter } from "../lib/rate-limiter/index.js";
import { sql } from "drizzle-orm";

const probes = new Hono();

// ─── Readiness ─────────────────────────────────────────────────
probes.get("/ready", async (c) => {
  const checks: Record<string, boolean> = {};
  let healthy = true;

  // DB check
  try {
    const db = getDb();
    await db.run(sql`SELECT 1`);
    checks.db = true;
  } catch {
    checks.db = false;
    healthy = false;
  }

  // Redis check (only if configured)
  const config = getConfig();
  if (config.rateLimitBackend === "redis") {
    try {
      const limiter = getRateLimiter();
      const ok = await limiter.ping();
      checks.redis = !!ok;
      if (!ok) healthy = false;
    } catch {
      checks.redis = false;
      healthy = false;
    }
  }

  const status = healthy ? "ok" : "degraded";
  return c.json({ status, checks }, healthy ? 200 : 503);
});

// ─── Startup ───────────────────────────────────────────────────
probes.get("/startup", async (c) => {
  const checks: Record<string, boolean> = {};
  let ready = true;

  try {
    const db = getDb();
    // Verify a core table exists (proves migrations ran)
    await db.run(sql`SELECT 1 FROM approval_requests LIMIT 1`);
    checks.migrations = true;
  } catch {
    checks.migrations = false;
    ready = false;
  }

  const status = ready ? "ok" : "not_ready";
  return c.json({ status, checks }, ready ? 200 : 503);
});

export default probes;
