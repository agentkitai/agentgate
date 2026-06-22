// @agentgate/server — Agent registry routes (agent-identity spine).
// CRUD for non-human agent principals. Admin-only (credential management).

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { createAgent, listAgents, revokeAgent } from "../lib/agents.js";
import { fetchAgentSpend, currentMonthWindow, SpendNotConfiguredError } from "../lib/agent-spend.js";
import { requirePermission } from "../middleware/auth.js";

// Variables: the auth middleware sets `auth` (carries the tenant) on the context.
const router = new Hono<{ Variables: { auth?: { tenantId?: string } } }>();

// Registering/revoking agent credentials is admin-level credential management.
router.use("*", requirePermission("keys:manage"));

const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

// Register a new agent — returns the secret ONCE.
router.post("/", zValidator("json", createAgentSchema), async (c) => {
  const { name, metadata } = c.req.valid("json");
  const { agent, secret } = await createAgent(name, metadata ?? null);
  return c.json(
    {
      ...agent,
      secret, // only returned on creation
      message:
        "Save this secret — it will not be shown again. The agent presents it as X-Agent-Secret alongside X-Agent-Id.",
    },
    201,
  );
});

// List agents (without secrets).
router.get("/", async (c) => {
  return c.json({ agents: await listAgents() });
});

// Per-agent spend report for the current calendar month (#13). Reads priced
// spend from AgentLens; informational (enforcement is checkAgentBudget).
router.get("/:id/spend", async (c) => {
  const id = c.req.param("id");
  const tenantId = c.get("auth")?.tenantId ?? "default";
  const window = currentMonthWindow();
  try {
    const spend = await fetchAgentSpend([id], tenantId, window);
    return c.json({
      agentId: id,
      tenantId,
      periodSpendUsd: spend.get(id) ?? 0,
      window,
    });
  } catch (err) {
    if (err instanceof SpendNotConfiguredError) {
      return c.json({ error: err.message }, 503);
    }
    return c.json({ error: "Failed to fetch spend from AgentLens" }, 502);
  }
});

// Revoke an agent.
router.delete("/:id", async (c) => {
  const ok = await revokeAgent(c.req.param("id"));
  if (!ok) return c.json({ error: "Agent not found or already revoked" }, 404);
  return c.body(null, 204);
});

export default router;
