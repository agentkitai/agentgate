// @agentgate/server - Public decision endpoint for one-click approve/deny

import { Hono } from "hono";
import { html } from "hono/html";
import { eq, and, isNull } from "drizzle-orm";
import { getDb, approvalRequests, decisionTokens } from "../db/index.js";
import { logAuditEvent } from "../lib/audit.js";
import { deliverWebhook } from "../lib/webhook.js";

const decideRouter = new Hono();

// HTML page generator
function htmlResponse(
  title: string,
  message: string,
  success: boolean,
  details?: Record<string, unknown>
) {
  const color = success ? "#22c55e" : "#ef4444";
  const icon = success ? "✓" : "✗";

  return html`<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="referrer" content="no-referrer" />
        <title>${title} - AgentGate</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
              "Helvetica Neue", Arial, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .card {
            background: #fff;
            border-radius: 16px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            padding: 48px;
            max-width: 480px;
            width: 100%;
            text-align: center;
          }
          .icon {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: ${color};
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px;
            font-size: 40px;
            color: white;
          }
          h1 {
            color: #1a1a2e;
            font-size: 24px;
            margin-bottom: 12px;
          }
          p {
            color: #64748b;
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 24px;
          }
          .details {
            background: #f8fafc;
            border-radius: 8px;
            padding: 16px;
            text-align: left;
            font-size: 14px;
            color: #475569;
          }
          .details dt {
            font-weight: 600;
            color: #1e293b;
          }
          .details dd {
            margin-bottom: 8px;
          }
          .footer {
            margin-top: 24px;
            color: #94a3b8;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">${icon}</div>
          <h1>${title}</h1>
          <p>${message}</p>
          ${
            details
              ? html`
                  <dl class="details">
                    ${Object.entries(details).map(
                      ([key, value]) => html`
                        <dt>${key}</dt>
                        <dd>${String(value)}</dd>
                      `
                    )}
                  </dl>
                `
              : ""
          }
          <p class="footer">AgentGate • Approval Management</p>
        </div>
      </body>
    </html>`;
}

// GET /api/decide/:token - One-click decision endpoint
decideRouter.get("/:token", async (c) => {
  // Prevent token leakage via Referer header
  c.header("Referrer-Policy", "no-referrer");

  const { token } = c.req.param();
  const now = new Date();

  // Find the token
  const tokenResult = await getDb()
    .select()
    .from(decisionTokens)
    .where(eq(decisionTokens.token, token))
    .limit(1);

  if (tokenResult.length === 0) {
    return c.html(
      htmlResponse(
        "Invalid Token",
        "This decision link is invalid or has been removed.",
        false
      ),
      404
    );
  }

  const tokenRecord = tokenResult[0]!;

  // Check if token is already used
  if (tokenRecord.usedAt) {
    return c.html(
      htmlResponse(
        "Already Used",
        "This decision link has already been used. Each link can only be used once.",
        false,
        { "Used at": tokenRecord.usedAt.toISOString() }
      ),
      400
    );
  }

  // Check if token is expired
  if (tokenRecord.expiresAt < now) {
    return c.html(
      htmlResponse(
        "Link Expired",
        "This decision link has expired. Please request a new approval link.",
        false,
        { "Expired at": tokenRecord.expiresAt.toISOString() }
      ),
      400
    );
  }

  // Determine the decision from the token action
  const decision = tokenRecord.action === "approve" ? "approved" : "denied";
  const decidedBy = "token";

  // Atomic conditional update: only update if request exists AND status is still 'pending'
  const result = await getDb()
    .update(approvalRequests)
    .set({
      status: decision,
      decidedAt: now,
      decidedBy,
      decisionReason: `Decision made via one-click ${tokenRecord.action} link`,
      updatedAt: now,
    })
    .where(and(
      eq(approvalRequests.id, tokenRecord.requestId),
      eq(approvalRequests.status, 'pending')
    ))
    .returning();

  if (result.length === 0) {
    // Re-read to determine error type: not found vs already decided
    const current = await getDb()
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, tokenRecord.requestId))
      .limit(1);

    if (current.length === 0) {
      return c.html(
        htmlResponse(
          "Request Not Found",
          "The associated approval request could not be found.",
          false
        ),
        404
      );
    }

    return c.html(
      htmlResponse(
        "Already Decided",
        `This request has already been ${current[0]!.status}.`,
        false,
        {
          Status: current[0]!.status,
          "Decided by": current[0]!.decidedBy || "Unknown",
          "Decided at": current[0]!.decidedAt?.toISOString() || "Unknown",
        }
      ),
      409
    );
  }

  const updatedRequest = result[0]!;

  // Mark token as used
  await getDb()
    .update(decisionTokens)
    .set({ usedAt: now })
    .where(eq(decisionTokens.id, tokenRecord.id));

  // Cross-invalidate all other tokens for this request
  await getDb()
    .update(decisionTokens)
    .set({ usedAt: now })
    .where(and(
      eq(decisionTokens.requestId, tokenRecord.requestId),
      isNull(decisionTokens.usedAt)
    ));

  // Log audit event
  await logAuditEvent(
    updatedRequest.id,
    decision === "approved" ? "approved" : "denied",
    decidedBy,
    {
      method: "token",
      tokenId: tokenRecord.id,
      automatic: false,
    }
  );

  // Deliver webhook
  await deliverWebhook(`request.${decision}`, {
    request: {
      id: updatedRequest.id,
      action: updatedRequest.action,
      params: updatedRequest.params ? JSON.parse(updatedRequest.params) : {},
      context: updatedRequest.context ? JSON.parse(updatedRequest.context) : {},
      status: updatedRequest.status,
      urgency: updatedRequest.urgency,
      createdAt: updatedRequest.createdAt.toISOString(),
      decidedAt: updatedRequest.decidedAt?.toISOString() || null,
      decidedBy: updatedRequest.decidedBy,
      decisionReason: updatedRequest.decisionReason,
    },
  });

  // Return success HTML
  const actionWord = decision === "approved" ? "Approved" : "Denied";
  const actionVerb = decision === "approved" ? "approved" : "denied";

  return c.html(
    htmlResponse(
      `Request ${actionWord}`,
      `The request has been successfully ${actionVerb}.`,
      decision === "approved",
      {
        "Request ID": updatedRequest.id,
        Action: updatedRequest.action,
        "Decided at": now.toISOString(),
      }
    )
  );
});

export default decideRouter;
