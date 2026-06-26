// @agentkitai/agentgate-server - Audit logging helper

import { nanoid } from "nanoid";
import { getDb, auditLogs } from "../db/index.js";

export type AuditEventType = "created" | "approved" | "denied" | "expired" | "viewed";

interface AuditDetails {
  [key: string]: unknown;
}

/**
 * Log an audit event for an approval request
 */
export async function logAuditEvent(
  requestId: string,
  eventType: AuditEventType,
  actor: string,
  details?: AuditDetails
): Promise<void> {
  await getDb().insert(auditLogs).values({
    id: nanoid(),
    requestId,
    eventType,
    actor,
    details: details ? JSON.stringify(details) : null,
    createdAt: new Date(),
  });
}
