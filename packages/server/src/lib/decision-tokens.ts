/**
 * Decision Token Generation
 *
 * Utility functions for generating one-click decision tokens
 * for use in notifications (Slack, email, etc.)
 */

import { nanoid } from "nanoid";
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db, approvalRequests, decisionTokens } from "../db/index.js";
import { getConfig } from "../config.js";
import { logAuditEvent } from "./audit.js";

/**
 * Token pair for approve/deny actions
 */
export interface DecisionTokens {
  approve: {
    token: string;
    url: string;
  };
  deny: {
    token: string;
    url: string;
  };
  expiresAt: string;
  expiresInHours: number;
}

/**
 * Generate a secure random token
 */
function generateSecureToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Generate decision tokens for a request
 *
 * @param requestId - The ID of the approval request
 * @returns Token pair with URLs, or null if request not found or not pending
 */
export async function generateDecisionTokens(
  requestId: string
): Promise<DecisionTokens | null> {
  const config = getConfig();

  // Check if request exists and is pending
  const existing = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, requestId))
    .limit(1);

  if (existing.length === 0) {
    return null;
  }

  const request = existing[0]!;

  // Only allow token generation for pending requests
  if (request.status !== "pending") {
    return null;
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
      requestId,
      action: "approve",
      token: approveToken,
      expiresAt,
      createdAt: now,
    },
    {
      id: denyId,
      requestId,
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
  await logAuditEvent(requestId, "viewed", "system", {
    event: "tokens_generated_for_notification",
    expiresAt: expiresAt.toISOString(),
  });

  return {
    approve: {
      token: approveToken,
      url: approveUrl,
    },
    deny: {
      token: denyToken,
      url: denyUrl,
    },
    expiresAt: expiresAt.toISOString(),
    expiresInHours: config.decisionTokenExpiryHours,
  };
}
