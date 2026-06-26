// @agentkitai/agentgate-server — MCP guardrail endpoint (issue #14).
// POST /api/mcp/authorize — the MCP server calls this before executing a tool.
// Mounted behind the normal /api/* auth middleware, so the caller's api key
// (and any virtual-key agent binding, #13) is available on the context.

import { Hono } from "hono";

import { resolveVerifiedAgentId, resolveEffectiveAgentId } from "../lib/agent-tokens.js";
import { evaluateMcpToolAccess } from "../lib/mcp-guardrails.js";
import { getConfig } from "../config.js";
import type { ApiKey } from "../db/schema.js";

const mcpRouter = new Hono<{ Variables: { apiKey?: ApiKey } }>();

mcpRouter.post("/authorize", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    toolName?: unknown;
    params?: Record<string, unknown>;
    context?: Record<string, unknown>;
  } | null;
  if (!body || typeof body.toolName !== "string" || !body.toolName.trim()) {
    return c.json({ error: "toolName is required" }, 400);
  }

  // Same verified-identity resolution as POST /api/requests: prefer an agent
  // Bearer token / X-Agent-* headers, else the virtual-key binding on the api
  // key the MCP server authenticated with.
  const verifiedAgentId = await resolveVerifiedAgentId(
    {
      agentToken: c.req.header("x-agent-token"),
      agentId: c.req.header("x-agent-id"),
      agentSecret: c.req.header("x-agent-secret"),
    },
    getConfig().authMode,
  );
  const resolved = await resolveEffectiveAgentId(c.get("apiKey")?.agentId ?? null, verifiedAgentId);
  if ("reject" in resolved) {
    return c.json(
      {
        error:
          resolved.reject === "conflict"
            ? "API key is bound to a different agent than the request claims"
            : "API key is bound to a revoked or unknown agent",
      },
      403,
    );
  }

  const verdict = await evaluateMcpToolAccess({
    verifiedAgentId: resolved.agentId,
    toolName: body.toolName,
    params: body.params,
    context: body.context,
  });
  return c.json(verdict, 200);
});

export default mcpRouter;
