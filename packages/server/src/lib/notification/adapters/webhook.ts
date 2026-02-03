/**
 * Webhook notification adapter
 *
 * Sends notifications to arbitrary HTTP endpoints.
 * Useful for custom integrations.
 */

import crypto from "crypto";
import type { AgentGateEvent } from "@agentgate/core";
import type { NotificationChannelAdapter, NotificationResult } from "../types.js";
import { getConfig } from "../../../config.js";

/**
 * Sign a payload with HMAC-SHA256
 */
export function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Build webhook payload from event
 */
export function buildWebhookPayload(event: AgentGateEvent): object {
  return {
    event: event.type,
    timestamp: event.timestamp,
    eventId: event.eventId,
    source: event.source,
    data: "payload" in event ? event.payload : {},
  };
}

/**
 * Webhook notification adapter
 */
export class WebhookAdapter implements NotificationChannelAdapter {
  readonly type = "webhook" as const;

  /**
   * Optional secret for HMAC signing
   */
  private secret?: string;

  constructor(options?: { secret?: string }) {
    this.secret = options?.secret;
  }

  isConfigured(): boolean {
    // Webhooks are always "configured" since they just need a URL
    return true;
  }

  async send(target: string, event: AgentGateEvent): Promise<NotificationResult> {
    const config = getConfig();
    const timestamp = Date.now();

    // Validate URL
    try {
      new URL(target);
    } catch {
      return {
        success: false,
        channel: this.type,
        target,
        error: "Invalid webhook URL",
        timestamp,
      };
    }

    try {
      const payload = buildWebhookPayload(event);
      const body = JSON.stringify(payload);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-AgentGate-Event": event.type,
        "X-AgentGate-EventId": event.eventId,
        "X-AgentGate-Timestamp": String(event.timestamp),
      };

      // Add signature if secret is available
      if (this.secret) {
        headers["X-AgentGate-Signature"] = signPayload(body, this.secret);
      }

      const response = await fetch(target, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(config.webhookTimeoutMs),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        return {
          success: false,
          channel: this.type,
          target,
          error: `HTTP ${response.status}: ${errorText.slice(0, 200)}`,
          timestamp,
          response: { statusCode: response.status },
        };
      }

      return {
        success: true,
        channel: this.type,
        target,
        timestamp,
        response: { statusCode: response.status },
      };
    } catch (error) {
      let errorMessage = "Unknown webhook error";
      if (error instanceof Error) {
        errorMessage = error.name === "TimeoutError" 
          ? "Request timed out"
          : error.message;
      }

      return {
        success: false,
        channel: this.type,
        target,
        error: errorMessage,
        timestamp,
      };
    }
  }
}
