// @agentgate/server - Decision token routes

import { Hono } from "hono";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db, approvalRequests, decisionTokens } from "../db/index.js";
import { getConfig } from "../config.js";
import { logAuditEvent } from "../lib/audit.js";

const tokensRouter = new Hono();

// Generate a secure random token
function generateSecureToken(): string {
  return randomBytes(32).toString("base64url");
}

// POST /api/requests/:id/tokens - Generate approve+deny token pair
tokensRouter.post("/requests/:id/tokens", async (c) => {
  const { id } = c.req.param();
  const config = getConfig();

  // Check if request exists
  const existing = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, id))
    .limit(1);

  if (existing.length === 0) {
    return c.json({ error: "Request not found" }, 404);
  }

  const request = existing[0]!;

  // Only allow token generation for pending requests
  if (request.status !== "pending") {
    return c.json(
      { error: `Request is not pending (current status: ${request.status})` },
      400
    );
  }

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + config.decisionTokenExpiryHours * 60 * 60 * 1000
  );

  // Generate token pair
  const approveToken = generateSecureToken();
  const denyToken = generateSecureToken();
  const approveId = nanoid();
  const denyId = nanoid();

  // Insert tokens
  await db.insert(decisionTokens).values([
    {
      id: approveId,
      requestId: id,
      action: "approve",
      token: approveToken,
      expiresAt,
      createdAt: now,
    },
    {
      id: denyId,
      requestId: id,
      action: "deny",
      token: denyToken,
      expiresAt,
      createdAt: now,
    },
  ]);

  // Build decision URLs
  const baseUrl = config.decisionLinkBaseUrl || `http://localhost:${config.port}`;
  const approveUrl = `${baseUrl}/api/decide/${approveToken}`;
  const denyUrl = `${baseUrl}/api/decide/${denyToken}`;

  // Log audit event
  await logAuditEvent(id, "viewed", "system", {
    event: "tokens_generated",
    expiresAt: expiresAt.toISOString(),
  });

  return c.json({
    requestId: id,
    tokens: {
      approve: {
        token: approveToken,
        url: approveUrl,
      },
      deny: {
        token: denyToken,
        url: denyUrl,
      },
    },
    expiresAt: expiresAt.toISOString(),
    expiresInHours: config.decisionTokenExpiryHours,
  });
});

export default tokensRouter;
