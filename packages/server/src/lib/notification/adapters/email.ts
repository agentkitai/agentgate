/**
 * Email notification adapter
 *
 * Sends notifications via SMTP using nodemailer.
 * For request.created events, generates approve/deny decision tokens
 * and includes one-click action links in the email.
 */

import type { AgentGateEvent, RequestCreatedEvent } from "@agentgate/core";
import type { NotificationChannelAdapter, NotificationResult } from "../types.js";
import { getConfig } from "../../../config.js";
import { generateDecisionTokens } from "../../decision-tokens.js";

// ============================================================================
// Types
// ============================================================================

export interface DecisionLinks {
  approveUrl: string;
  denyUrl: string;
  viewUrl?: string;
}

// ============================================================================
// Decision Link Generation
// ============================================================================

/**
 * Generate decision links for email notifications
 * Uses the shared generateDecisionTokens function and adds dashboard URL
 */
export async function generateDecisionLinks(
  requestId: string
): Promise<DecisionLinks | null> {
  const config = getConfig();

  // Generate tokens using shared function
  const tokens = await generateDecisionTokens(requestId);
  if (!tokens) {
    return null;
  }

  // Build view URL if dashboard URL is configured
  let viewUrl: string | undefined;
  if (config.dashboardUrl) {
    viewUrl = `${config.dashboardUrl}/requests/${requestId}`;
  }

  return {
    approveUrl: tokens.approve.url,
    denyUrl: tokens.deny.url,
    viewUrl,
  };
}

// ============================================================================
// Email Formatting
// ============================================================================

/**
 * Format an event as an email subject
 */
export function formatEmailSubject(event: AgentGateEvent): string {
  const prefix = "[AgentGate]";

  switch (event.type) {
    case "request.created":
      return `${prefix} 🔔 Approval required: ${event.payload.action}`;
    case "request.decided": {
      const emoji = event.payload.status === "approved" ? "✅" : "❌";
      return `${prefix} ${emoji} Request ${event.payload.status}: ${event.payload.action}`;
    }
    case "request.expired":
      return `${prefix} ⏰ Request expired: ${event.payload.action}`;
    case "request.escalated":
      return `${prefix} ⬆️ Request escalated: ${event.payload.action}`;
    default:
      return `${prefix} ${event.type}`;
  }
}

/**
 * Format an event as plain text email body
 */
export function formatEmailBody(
  event: AgentGateEvent,
  links?: DecisionLinks
): string {
  const lines: string[] = [];

  lines.push(`Event: ${event.type}`);
  lines.push(`Time: ${new Date(event.timestamp).toISOString()}`);
  lines.push(`Source: ${event.source}`);
  lines.push("");

  if ("payload" in event) {
    lines.push("Details:");
    for (const [key, value] of Object.entries(event.payload)) {
      if (typeof value === "object") {
        lines.push(`  ${key}: ${JSON.stringify(value)}`);
      } else {
        lines.push(`  ${key}: ${value}`);
      }
    }
  }

  // Add action links for request.created events
  if (links) {
    lines.push("");
    lines.push("Quick Actions:");
    lines.push(`  Approve: ${links.approveUrl}`);
    lines.push(`  Deny: ${links.denyUrl}`);
    if (links.viewUrl) {
      lines.push(`  View in Dashboard: ${links.viewUrl}`);
    }
  }

  return lines.join("\n");
}

/**
 * Get urgency color for styling
 */
function getUrgencyColor(urgency: string): string {
  switch (urgency) {
    case "critical":
      return "#dc2626"; // red-600
    case "high":
      return "#ea580c"; // orange-600
    case "normal":
      return "#ca8a04"; // yellow-600
    case "low":
      return "#16a34a"; // green-600
    default:
      return "#6b7280"; // gray-500
  }
}

/**
 * Get urgency emoji
 */
function getUrgencyEmoji(urgency: string): string {
  switch (urgency) {
    case "critical":
      return "🔴";
    case "high":
      return "🟠";
    case "normal":
      return "🟡";
    case "low":
      return "🟢";
    default:
      return "⚪";
  }
}

/**
 * Format JSON for display in emails
 */
function formatJson(obj: Record<string, unknown>, maxLen = 500): string {
  const str = JSON.stringify(obj, null, 2);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

/**
 * Build HTML email for request.created event with action buttons
 */
export function buildRequestCreatedHtml(
  event: RequestCreatedEvent,
  links: DecisionLinks
): string {
  const { payload } = event;
  const urgencyColor = getUrgencyColor(payload.urgency);
  const urgencyEmoji = getUrgencyEmoji(payload.urgency);

  const paramsHtml =
    payload.params && Object.keys(payload.params).length > 0
      ? `
      <tr>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #374151;">Parameters</strong><br/>
          <pre style="background: #f3f4f6; padding: 12px; border-radius: 6px; font-size: 12px; margin: 8px 0 0 0; overflow-x: auto; white-space: pre-wrap;">${formatJson(payload.params as Record<string, unknown>)}</pre>
        </td>
      </tr>`
      : "";

  const contextHtml =
    payload.context && Object.keys(payload.context).length > 0
      ? `
      <tr>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #374151;">Context</strong><br/>
          <pre style="background: #f3f4f6; padding: 12px; border-radius: 6px; font-size: 12px; margin: 8px 0 0 0; overflow-x: auto; white-space: pre-wrap;">${formatJson(payload.context as Record<string, unknown>)}</pre>
        </td>
      </tr>`
      : "";

  const policyHtml = payload.policyDecision
    ? `
      <tr>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #374151;">Policy Decision</strong><br/>
          <span style="color: #6b7280;">${payload.policyDecision.decision}${payload.policyDecision.policyId ? ` (Policy: ${payload.policyDecision.policyId})` : ""}</span>
        </td>
      </tr>`
    : "";

  const viewLinkHtml = links.viewUrl
    ? `
      <tr>
        <td style="padding: 16px; text-align: center;">
          <a href="${links.viewUrl}" style="color: #3b82f6; text-decoration: none; font-size: 14px;">View in Dashboard →</a>
        </td>
      </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Approval Request</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1f2937 0%, #374151 100%); padding: 32px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">🔔 Approval Required</h1>
              <p style="margin: 8px 0 0 0; color: #d1d5db; font-size: 14px;">A new request is waiting for your decision</p>
            </td>
          </tr>

          <!-- Urgency Badge -->
          <tr>
            <td style="padding: 24px 24px 0 24px; text-align: center;">
              <span style="display: inline-block; background-color: ${urgencyColor}; color: #ffffff; padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: 600; text-transform: uppercase;">
                ${urgencyEmoji} ${payload.urgency} Priority
              </span>
            </td>
          </tr>

          <!-- Action Buttons -->
          <tr>
            <td style="padding: 24px; text-align: center;">
              <table cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                <tr>
                  <td style="padding-right: 12px;">
                    <a href="${links.approveUrl}" style="display: inline-block; background-color: #22c55e; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">✓ Approve</a>
                  </td>
                  <td style="padding-left: 12px;">
                    <a href="${links.denyUrl}" style="display: inline-block; background-color: #ef4444; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">✗ Deny</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 24px;">
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 0;">
            </td>
          </tr>

          <!-- Request Details -->
          <tr>
            <td>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb;">
                    <strong style="color: #374151;">Action</strong><br/>
                    <code style="background: #f3f4f6; padding: 4px 8px; border-radius: 4px; font-size: 14px; color: #1f2937;">${payload.action}</code>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb;">
                    <strong style="color: #374151;">Request ID</strong><br/>
                    <code style="background: #f3f4f6; padding: 4px 8px; border-radius: 4px; font-size: 12px; color: #6b7280;">${payload.requestId}</code>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb;">
                    <strong style="color: #374151;">Created</strong><br/>
                    <span style="color: #6b7280;">${new Date(event.timestamp).toLocaleString()}</span>
                  </td>
                </tr>
                ${paramsHtml}
                ${contextHtml}
                ${policyHtml}
              </table>
            </td>
          </tr>

          <!-- View in Dashboard Link -->
          ${viewLinkHtml}

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                This email was sent by AgentGate • Event ID: ${event.eventId}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Build HTML email for request.decided event
 */
export function buildRequestDecidedHtml(
  event: Extract<AgentGateEvent, { type: "request.decided" }>
): string {
  const { payload } = event;
  const isApproved = payload.status === "approved";
  const statusColor = isApproved ? "#22c55e" : "#ef4444";
  const statusEmoji = isApproved ? "✅" : "❌";
  const statusText = isApproved ? "Approved" : "Denied";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Request ${statusText}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background-color: ${statusColor}; padding: 32px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">${statusEmoji} Request ${statusText}</h1>
            </td>
          </tr>

          <!-- Request Details -->
          <tr>
            <td>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding: 16px; border-bottom: 1px solid #e5e7eb;">
                    <strong style="color: #374151;">Action</strong><br/>
                    <code style="background: #f3f4f6; padding: 4px 8px; border-radius: 4px; font-size: 14px; color: #1f2937;">${payload.action}</code>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px; border-bottom: 1px solid #e5e7eb;">
                    <strong style="color: #374151;">Request ID</strong><br/>
                    <code style="background: #f3f4f6; padding: 4px 8px; border-radius: 4px; font-size: 12px; color: #6b7280;">${payload.requestId}</code>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px; border-bottom: 1px solid #e5e7eb;">
                    <strong style="color: #374151;">Decided By</strong><br/>
                    <span style="color: #6b7280;">${payload.decidedBy} (${payload.decidedByType})</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px; border-bottom: 1px solid #e5e7eb;">
                    <strong style="color: #374151;">Decision Time</strong><br/>
                    <span style="color: #6b7280;">${(payload.decisionTimeMs / 1000).toFixed(1)} seconds</span>
                  </td>
                </tr>
                ${
                  payload.reason
                    ? `<tr>
                  <td style="padding: 16px; border-bottom: 1px solid #e5e7eb;">
                    <strong style="color: #374151;">Reason</strong><br/>
                    <span style="color: #6b7280;">${payload.reason}</span>
                  </td>
                </tr>`
                    : ""
                }
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                This email was sent by AgentGate • Event ID: ${event.eventId}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Build generic HTML email for other events
 */
export function buildGenericHtml(event: AgentGateEvent): string {
  const urgencyColors: Record<string, string> = {
    low: "#22c55e",
    normal: "#eab308",
    high: "#f97316",
    critical: "#ef4444",
  };

  let urgencyBadge = "";
  if ("payload" in event && "urgency" in event.payload) {
    const urgency = event.payload.urgency as string;
    const color = urgencyColors[urgency] || "#6b7280";
    urgencyBadge = `<span style="background-color: ${color}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; text-transform: uppercase;">${urgency}</span>`;
  }

  let html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #1f2937; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; }
    .field { margin-bottom: 12px; }
    .label { font-weight: 600; color: #374151; }
    .value { color: #1f2937; }
    pre { background: #e5e7eb; padding: 12px; border-radius: 4px; overflow-x: auto; }
    .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0; font-size: 20px;">🔔 AgentGate Notification</h1>
      ${urgencyBadge ? `<div style="margin-top: 8px;">${urgencyBadge}</div>` : ""}
    </div>
    <div class="content">
      <div class="field">
        <span class="label">Event:</span>
        <span class="value">${event.type}</span>
      </div>
      <div class="field">
        <span class="label">Time:</span>
        <span class="value">${new Date(event.timestamp).toLocaleString()}</span>
      </div>
`;

  if ("payload" in event) {
    if ("requestId" in event.payload) {
      html += `
      <div class="field">
        <span class="label">Request ID:</span>
        <span class="value"><code>${event.payload.requestId}</code></span>
      </div>`;
    }
    if ("action" in event.payload) {
      html += `
      <div class="field">
        <span class="label">Action:</span>
        <span class="value"><code>${event.payload.action}</code></span>
      </div>`;
    }
    if ("status" in event.payload) {
      const status = event.payload.status as string;
      const statusColor = status === "approved" ? "#22c55e" : "#ef4444";
      html += `
      <div class="field">
        <span class="label">Status:</span>
        <span class="value" style="color: ${statusColor}; font-weight: 600;">${status.toUpperCase()}</span>
      </div>`;
    }
    if ("params" in event.payload && Object.keys(event.payload.params as object).length > 0) {
      html += `
      <div class="field">
        <span class="label">Parameters:</span>
        <pre>${JSON.stringify(event.payload.params, null, 2)}</pre>
      </div>`;
    }
  }

  html += `
    </div>
    <div class="footer">
      Sent by AgentGate • Event ID: ${event.eventId}
    </div>
  </div>
</body>
</html>`;

  return html;
}

/**
 * Format an event as HTML email body
 * For request.created events, includes action buttons if links are provided
 */
export function formatEmailHtml(
  event: AgentGateEvent,
  links?: DecisionLinks
): string {
  switch (event.type) {
    case "request.created":
      if (links) {
        return buildRequestCreatedHtml(event, links);
      }
      return buildGenericHtml(event);
    case "request.decided":
      return buildRequestDecidedHtml(event);
    default:
      return buildGenericHtml(event);
  }
}

// ============================================================================
// Email Adapter Class
// ============================================================================

/**
 * Email notification adapter
 * Sends notifications via SMTP using nodemailer
 */
export class EmailAdapter implements NotificationChannelAdapter {
  readonly type = "email" as const;

  isConfigured(): boolean {
    const config = getConfig();
    return Boolean(config.smtpHost && config.smtpFrom);
  }

  async send(
    target: string,
    event: AgentGateEvent
  ): Promise<NotificationResult> {
    const config = getConfig();
    const timestamp = Date.now();

    if (!this.isConfigured()) {
      return {
        success: false,
        channel: this.type,
        target,
        error: "SMTP not configured (missing SMTP_HOST or SMTP_FROM)",
        timestamp,
      };
    }

    try {
      // Generate decision links for request.created events
      let links: DecisionLinks | undefined;
      if (event.type === "request.created") {
        const generatedLinks = await generateDecisionLinks(event.payload.requestId);
        if (generatedLinks) {
          links = generatedLinks;
        }
      }

      // Dynamic import to avoid requiring nodemailer when not using email
      const nodemailer = await import("nodemailer");

      const transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort || 587,
        secure: config.smtpPort === 465,
        auth: config.smtpUser
          ? {
              user: config.smtpUser,
              pass: config.smtpPass,
            }
          : undefined,
      });

      const subject = formatEmailSubject(event);
      const text = formatEmailBody(event, links);
      const html = formatEmailHtml(event, links);

      const result = await transporter.sendMail({
        from: config.smtpFrom,
        to: target,
        subject,
        text,
        html,
      });

      return {
        success: true,
        channel: this.type,
        target,
        timestamp,
        response: {
          messageId: result.messageId,
          ...(links ? { decisionLinks: links } : {}),
        },
      };
    } catch (error) {
      return {
        success: false,
        channel: this.type,
        target,
        error: error instanceof Error ? error.message : "Unknown email error",
        timestamp,
      };
    }
  }
}
