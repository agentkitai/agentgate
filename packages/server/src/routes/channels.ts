/**
 * Channel health & test routes
 *
 * GET  /api/channels/health       - Returns health status of all registered channels
 * POST /api/channels/:type/test   - Sends a test notification to verify a channel works
 */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getGlobalDispatcher } from "../lib/notification/dispatcher.js";
import { getHealthTracker } from "../lib/notification/health.js";
import type { AgentGateEvent } from "@agentgate/core";
import { randomUUID } from "node:crypto";

const router = new Hono();

// ============================================================================
// GET /health - Channel health status
// ============================================================================

router.get("/health", async (c) => {
  const tracker = getHealthTracker();
  const dispatcher = getGlobalDispatcher();
  const healthRecord = tracker.getHealthRecord();

  // Ensure all registered adapter types appear in the response
  const channelTypes = ["email", "slack", "discord", "webhook"] as const;
  const result: Record<string, unknown> = {};

  for (const type of channelTypes) {
    const configured = dispatcher.isChannelConfigured(type);
    const health = healthRecord[type];

    result[type] = {
      configured,
      ...(health ?? {
        type,
        successCount: 0,
        failureCount: 0,
        consecutiveFailures: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
        status: "healthy",
      }),
    };
  }

  return c.json({ channels: result });
});

// ============================================================================
// POST /:type/test - Send a test notification
// ============================================================================

const testBodySchema = z.object({
  target: z.string().min(1, "target is required"),
});

router.post("/:type/test", zValidator("json", testBodySchema), async (c) => {
  const type = c.req.param("type");
  const { target } = c.req.valid("json");

  const dispatcher = getGlobalDispatcher();
  const adapter = dispatcher.getAdapter(type as any);

  if (!adapter) {
    return c.json(
      { error: `Unknown channel type: ${type}` },
      400
    );
  }

  if (!adapter.isConfigured()) {
    return c.json(
      { error: `Channel "${type}" is not configured` },
      400
    );
  }

  // Build a synthetic test event
  const testEvent: AgentGateEvent = {
    eventId: randomUUID(),
    type: "request.created",
    timestamp: Date.now(),
    source: "agentgate:channel-test",
    payload: {
      requestId: "test-" + randomUUID().slice(0, 8),
      action: "channel.test",
      urgency: "low" as const,
      params: { note: "This is a test notification from AgentGate" },
      context: {},
    },
  } as AgentGateEvent;

  try {
    const result = await adapter.send(target, testEvent);

    // Record health from the test
    const tracker = getHealthTracker();
    if (result.success) {
      tracker.recordSuccess(type);
    } else {
      tracker.recordFailure(type);
    }

    if (result.success) {
      return c.json({ success: true, channel: type, target });
    } else {
      return c.json(
        { success: false, channel: type, target, error: result.error },
        502
      );
    }
  } catch (error) {
    const tracker = getHealthTracker();
    tracker.recordFailure(type);

    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json(
      { success: false, channel: type, target, error: message },
      502
    );
  }
});

export default router;
