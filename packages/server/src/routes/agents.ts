// @agentgate/server — Agent registry routes (agent-identity spine).
// CRUD for non-human agent principals. Admin-only (credential management).

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { createAgent, listAgents, revokeAgent } from "../lib/agents.js";
import { requirePermission } from "../middleware/auth.js";

const router = new Hono();

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

// Revoke an agent.
router.delete("/:id", async (c) => {
  const ok = await revokeAgent(c.req.param("id"));
  if (!ok) return c.json({ error: "Agent not found or already revoked" }, 404);
  return c.body(null, 204);
});

export default router;
