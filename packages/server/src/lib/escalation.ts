/**
 * Escalation scanner — periodically checks for pending requests that should
 * be escalated based on configured escalation rules.
 *
 * Feature-5: Escalation Policies with On-Call Schedules
 */

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, approvalRequests, escalationRules, escalationHistory } from "../db/index.js";
import { getLogger } from "./logger.js";
import { deliverWebhook } from "./webhook.js";
import { logAuditEvent } from "./audit.js";
import {
  EventNames,
  createBaseEvent,
  getGlobalEmitter,
  type RequestEscalatedEvent,
  type RequestDecidedEvent,
} from "@agentkitai/agentgate-core";

/** Parse an escalateTo of the form `decision:approve` / `decision:deny`. */
function parseFallbackDecision(escalateTo: string): "approved" | "denied" | null {
  if (escalateTo === "decision:approve") return "approved";
  if (escalateTo === "decision:deny") return "denied";
  return null;
}

/**
 * Terminal fallback (#44): when an escalation rule's target is a `decision:*`,
 * auto-resolve a still-pending request instead of notifying — so a request that
 * no human ever answers doesn't sit pending forever. Mirrors the auto-decision
 * side effects (audit + event + webhook) so downstream sees a normal decision.
 */
async function applyFallbackDecision(
  request: typeof approvalRequests.$inferSelect,
  status: "approved" | "denied",
  triggerAfterSec: number,
): Promise<void> {
  const db = getDb();
  const reason = `No decision after ${triggerAfterSec}s — escalation fallback ${status}`;
  await db
    .update(approvalRequests)
    .set({ status, decidedAt: new Date(), decidedBy: "escalation_fallback", decisionReason: reason })
    .where(eq(approvalRequests.id, request.id));

  await logAuditEvent(request.id, status, "escalation_fallback", {
    reason,
    automatic: true,
    decidedByType: "escalation_fallback",
  });

  const decidedEvent: RequestDecidedEvent = {
    ...createBaseEvent(EventNames.REQUEST_DECIDED, "escalation-scanner"),
    payload: {
      requestId: request.id,
      action: request.action,
      status,
      decidedBy: "escalation_fallback",
      decidedByType: "escalation_fallback",
      reason,
      decisionTimeMs: 0,
    },
  };
  getGlobalEmitter().emitSync(decidedEvent);

  try {
    await deliverWebhook(`request.${status}`, { request });
  } catch {
    // best-effort: the decision already persisted
  }
}

let scannerTimer: NodeJS.Timeout | null = null;

/**
 * Run a single escalation scan pass.
 *
 * 1. Load all pending requests
 * 2. Load enabled escalation rules (ordered by priority desc)
 * 3. For each pending request where createdAt + triggerAfterSec < now
 *    AND no escalation history exists for this request+rule combo:
 *    - Insert escalation_history record
 *    - Deliver notification via webhook to the escalation target channel
 *    - Emit RequestEscalatedEvent
 * 4. Return count of escalations triggered
 */
export async function scanPendingEscalations(): Promise<number> {
  const db = getDb();
  const log = getLogger();
  const now = Math.floor(Date.now() / 1000); // unix seconds

  // 1. Load all pending requests
  const pendingRequests = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.status, "pending"));

  if (pendingRequests.length === 0) {
    return 0;
  }

  // 2. Load enabled escalation rules ordered by priority (descending)
  const rules = await db
    .select()
    .from(escalationRules)
    .where(eq(escalationRules.enabled, 1));

  if (rules.length === 0) {
    return 0;
  }

  // Sort by priority descending
  rules.sort((a, b) => b.priority - a.priority);

  // 3. Load existing escalation history to avoid duplicates
  const existingHistory = await db
    .select({
      requestId: escalationHistory.requestId,
      ruleId: escalationHistory.ruleId,
    })
    .from(escalationHistory);

  // Build a Set of "requestId:ruleId" for fast lookup
  const alreadyEscalated = new Set(
    existingHistory.map((h) => `${h.requestId}:${h.ruleId}`)
  );

  let escalationCount = 0;

  for (const request of pendingRequests) {
    // Get request createdAt as unix seconds
    const requestCreatedAt =
      request.createdAt instanceof Date
        ? Math.floor(request.createdAt.getTime() / 1000)
        : typeof request.createdAt === "number"
          ? request.createdAt
          : 0;

    for (const rule of rules) {
      // Check if this request has been pending long enough for this rule
      if (requestCreatedAt + rule.triggerAfterSec >= now) {
        continue; // Not yet due
      }

      // Check if already escalated for this combo
      const key = `${request.id}:${rule.id}`;
      if (alreadyEscalated.has(key)) {
        continue;
      }

      // If rule has a policyId, it only applies to requests matched by that policy
      // (for now, null policyId means global — applies to all)
      // Future: check request's matched policyId

      // Insert escalation history record
      const historyId = nanoid();
      await db.insert(escalationHistory).values({
        id: historyId,
        requestId: request.id,
        ruleId: rule.id,
        escalatedAt: now,
        fromChannel: null,
        toChannel: rule.escalateTo,
      });

      // Mark as escalated so we don't process again in this pass
      alreadyEscalated.add(key);

      // Terminal fallback rule (#44): resolve the request instead of notifying,
      // then stop — it's no longer pending, so later rungs don't apply.
      const fallback = parseFallbackDecision(rule.escalateTo);
      if (fallback) {
        await applyFallbackDecision(request, fallback, rule.triggerAfterSec);
        log.info(
          { requestId: request.id, ruleId: rule.id, decision: fallback },
          "Escalation fallback decision applied"
        );
        escalationCount++;
        break; // request resolved — skip remaining rules for it
      }

      // Dispatch notification via webhook
      const escalationEvent: RequestEscalatedEvent = {
        ...createBaseEvent(EventNames.REQUEST_ESCALATED, "escalation-scanner"),
        payload: {
          requestId: request.id,
          action: request.action,
          toChannel: rule.escalateTo,
          reason: `Request pending for >${rule.triggerAfterSec}s — escalated to ${rule.escalateTo}`,
        },
      };

      try {
        await deliverWebhook(EventNames.REQUEST_ESCALATED, escalationEvent.payload);
      } catch (err) {
        log.error({ err, requestId: request.id, ruleId: rule.id }, "Failed to deliver escalation webhook");
      }

      log.info(
        { requestId: request.id, ruleId: rule.id, escalateTo: rule.escalateTo },
        "Escalation triggered"
      );

      escalationCount++;
    }
  }

  if (escalationCount > 0) {
    log.info({ count: escalationCount }, "Escalation scan pass completed");
  }

  return escalationCount;
}

/**
 * Start the periodic escalation scanner (every 30 seconds).
 */
export function startEscalationScanner(): NodeJS.Timeout {
  scannerTimer = setInterval(() => {
    scanPendingEscalations().catch((err) =>
      getLogger().error({ err }, "Escalation scanner error")
    );
  }, 30_000);

  // Don't block process exit
  scannerTimer.unref();

  return scannerTimer;
}

/**
 * Stop the periodic escalation scanner.
 */
export function stopEscalationScanner(): void {
  if (scannerTimer) {
    clearInterval(scannerTimer);
    scannerTimer = null;
  }
}
