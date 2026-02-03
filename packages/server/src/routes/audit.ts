// @agentgate/server - Audit log API routes

import { Hono } from "hono";
import { eq, and, gte, lte, desc, sql, type SQL } from "drizzle-orm";
import { db, auditLogs, approvalRequests } from "../db/index.js";

const auditRouter = new Hono();

// Helper to format audit log entries with request details
interface AuditEntryWithRequest {
  id: string;
  requestId: string;
  eventType: string;
  actor: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  request: {
    id: string;
    action: string;
    status: string;
    urgency: string;
  } | null;
}

// GET /api/audit - List audit entries with filters and pagination
auditRouter.get("/", async (c) => {
  // Query params
  const action = c.req.query("action");
  const status = c.req.query("status");
  const eventType = c.req.query("eventType");
  const actor = c.req.query("actor");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const requestId = c.req.query("requestId");
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  // Build conditions for audit logs
  const auditConditions: SQL[] = [];

  // Date filters
  if (from) {
    const fromDate = new Date(from);
    if (!isNaN(fromDate.getTime())) {
      auditConditions.push(gte(auditLogs.createdAt, fromDate));
    }
  }

  if (to) {
    const toDate = new Date(to);
    if (!isNaN(toDate.getTime())) {
      // Set to end of day
      toDate.setHours(23, 59, 59, 999);
      auditConditions.push(lte(auditLogs.createdAt, toDate));
    }
  }

  // Event type filter
  const validEventTypes = ["created", "approved", "denied", "expired", "viewed"];
  if (eventType && validEventTypes.includes(eventType)) {
    auditConditions.push(
      eq(auditLogs.eventType, eventType as "created" | "approved" | "denied" | "expired" | "viewed")
    );
  }

  // Actor filter
  if (actor) {
    auditConditions.push(eq(auditLogs.actor, actor));
  }

  // Request ID filter
  if (requestId) {
    auditConditions.push(eq(auditLogs.requestId, requestId));
  }

  // For action and status filters, we need to join with approvalRequests
  const requestConditions: SQL[] = [];
  if (action) {
    requestConditions.push(eq(approvalRequests.action, action));
  }
  const validStatuses = ["pending", "approved", "denied", "expired"];
  if (status && validStatuses.includes(status)) {
    requestConditions.push(
      eq(approvalRequests.status, status as "pending" | "approved" | "denied" | "expired")
    );
  }

  // Build the query with join
  let whereClause: SQL | undefined;
  const allConditions = [...auditConditions, ...requestConditions];
  if (allConditions.length > 0) {
    whereClause = and(...allConditions);
  }

  // Execute query with join
  const query = db
    .select({
      audit: auditLogs,
      request: {
        id: approvalRequests.id,
        action: approvalRequests.action,
        status: approvalRequests.status,
        urgency: approvalRequests.urgency,
      },
    })
    .from(auditLogs)
    .leftJoin(approvalRequests, eq(auditLogs.requestId, approvalRequests.id))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);

  const results = whereClause 
    ? await query.where(whereClause)
    : await query;

  // Get total count for pagination
  const countQuery = db
    .select({ count: sql<number>`count(*)` })
    .from(auditLogs)
    .leftJoin(approvalRequests, eq(auditLogs.requestId, approvalRequests.id));

  const countResult = whereClause
    ? await countQuery.where(whereClause)
    : await countQuery;

  const total = countResult[0]?.count || 0;

  // Format response
  const entries: AuditEntryWithRequest[] = results.map((row) => ({
    id: row.audit.id,
    requestId: row.audit.requestId,
    eventType: row.audit.eventType,
    actor: row.audit.actor,
    details: row.audit.details ? JSON.parse(row.audit.details) : null,
    createdAt: row.audit.createdAt.toISOString(),
    request: row.request
      ? {
          id: row.request.id,
          action: row.request.action,
          status: row.request.status,
          urgency: row.request.urgency,
        }
      : null,
  }));

  return c.json({
    entries,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + results.length < total,
    },
  });
});

// GET /api/audit/actions - Get unique action values for filter dropdown
auditRouter.get("/actions", async (c) => {
  const results = await db
    .selectDistinct({ action: approvalRequests.action })
    .from(approvalRequests)
    .orderBy(approvalRequests.action);

  return c.json({
    actions: results.map((r) => r.action),
  });
});

// GET /api/audit/actors - Get unique actor values for filter dropdown
auditRouter.get("/actors", async (c) => {
  const results = await db
    .selectDistinct({ actor: auditLogs.actor })
    .from(auditLogs)
    .orderBy(auditLogs.actor);

  return c.json({
    actors: results.map((r) => r.actor),
  });
});

export default auditRouter;
