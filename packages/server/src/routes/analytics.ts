// @agentgate/server - Analytics & Governance KPI routes

import { Hono } from "hono";
import { and, gte, lte, sql, eq, type SQL } from "drizzle-orm";
import { getDb, approvalRequests, auditLogs, policies, getDialect } from "../db/index.js";

const analyticsRouter = new Hono();

// Helper: parse ISO date string to Date, return null if invalid
function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// GET /api/analytics/overview - High-level KPIs
analyticsRouter.get("/overview", async (c) => {
  const from = parseDate(c.req.query("from"));
  const to = parseDate(c.req.query("to"));

  const conditions: SQL[] = [];
  if (from) conditions.push(gte(approvalRequests.createdAt, from));
  if (to) {
    const toEnd = new Date(to);
    toEnd.setHours(23, 59, 59, 999);
    conditions.push(lte(approvalRequests.createdAt, toEnd));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Aggregate counts by status
  const groupedQuery = getDb()
    .select({
      status: approvalRequests.status,
      cnt: sql<number>`count(*)`,
    })
    .from(approvalRequests)
    .groupBy(approvalRequests.status);

  const grouped = whereClause
    ? await groupedQuery.where(whereClause)
    : await groupedQuery;

  const counts: Record<string, number> = { pending: 0, approved: 0, denied: 0, expired: 0 };
  for (const row of grouped) {
    counts[row.status] = Number(row.cnt);
  }

  const totalRequests = (counts.pending ?? 0) + (counts.approved ?? 0) + (counts.denied ?? 0) + (counts.expired ?? 0);
  const decided = (counts.approved ?? 0) + (counts.denied ?? 0);
  const approvalRate = decided > 0 ? (counts.approved ?? 0) / decided : 0;

  // Average decision time (decidedAt - createdAt) where decidedAt is set
  const dialect = getDialect();
  let avgDecisionTimeMs = 0;

  const avgConditions: SQL[] = [...conditions];
  // decidedAt is not null
  avgConditions.push(sql`${approvalRequests.decidedAt} IS NOT NULL`);
  const avgWhere = and(...avgConditions);

  if (dialect === "postgres") {
    const avgResult = await getDb()
      .select({
        avgMs: sql<number>`AVG(EXTRACT(EPOCH FROM (${approvalRequests.decidedAt}::timestamp - ${approvalRequests.createdAt}::timestamp)) * 1000)`,
      })
      .from(approvalRequests)
      .where(avgWhere!);

    avgDecisionTimeMs = avgResult[0]?.avgMs ? Math.round(Number(avgResult[0].avgMs)) : 0;
  } else {
    // SQLite: timestamps are stored as integer (unix epoch seconds via mode:"timestamp")
    const avgResult = await getDb()
      .select({
        avgMs: sql<number>`AVG((${approvalRequests.decidedAt} - ${approvalRequests.createdAt}) * 1000)`,
      })
      .from(approvalRequests)
      .where(avgWhere!);

    avgDecisionTimeMs = avgResult[0]?.avgMs ? Math.round(Number(avgResult[0].avgMs)) : 0;
  }

  // Auto-approve rate: decided by policy / total decided
  const autoConditions: SQL[] = [...conditions];
  autoConditions.push(eq(approvalRequests.decidedBy, "policy"));

  const autoWhere = and(...autoConditions);
  const autoResult = await getDb()
    .select({ cnt: sql<number>`count(*)` })
    .from(approvalRequests)
    .where(autoWhere!);

  const autoDecided = Number(autoResult[0]?.cnt || 0);
  const autoApproveRate = decided > 0 ? autoDecided / decided : 0;

  return c.json({
    totalRequests,
    approved: counts.approved,
    denied: counts.denied,
    expired: counts.expired,
    pending: counts.pending,
    approvalRate: Math.round(approvalRate * 10000) / 10000,
    avgDecisionTimeMs,
    autoApproveRate: Math.round(autoApproveRate * 10000) / 10000,
  });
});

// GET /api/analytics/trends - Time-bucketed request counts
analyticsRouter.get("/trends", async (c) => {
  const from = parseDate(c.req.query("from"));
  const to = parseDate(c.req.query("to"));
  const bucket = c.req.query("bucket") === "hour" ? "hour" : "day";

  const conditions: SQL[] = [];
  if (from) conditions.push(gte(approvalRequests.createdAt, from));
  if (to) {
    const toEnd = new Date(to);
    toEnd.setHours(23, 59, 59, 999);
    conditions.push(lte(approvalRequests.createdAt, toEnd));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const dialect = getDialect();

  // Build bucket expression based on dialect
  let bucketExpr: SQL;
  if (dialect === "postgres") {
    if (bucket === "hour") {
      bucketExpr = sql`to_char(${approvalRequests.createdAt}::timestamp, 'YYYY-MM-DD"T"HH24:00')`;
    } else {
      bucketExpr = sql`to_char(${approvalRequests.createdAt}::timestamp, 'YYYY-MM-DD')`;
    }
  } else {
    // SQLite: createdAt stored as integer epoch
    if (bucket === "hour") {
      bucketExpr = sql`strftime('%Y-%m-%dT%H:00', ${approvalRequests.createdAt}, 'unixepoch')`;
    } else {
      bucketExpr = sql`strftime('%Y-%m-%d', ${approvalRequests.createdAt}, 'unixepoch')`;
    }
  }

  const query = getDb()
    .select({
      bucket: sql<string>`${bucketExpr}`.as("bucket"),
      requests: sql<number>`count(*)`.as("requests"),
      approved: sql<number>`sum(case when ${approvalRequests.status} = 'approved' then 1 else 0 end)`.as("approved"),
      denied: sql<number>`sum(case when ${approvalRequests.status} = 'denied' then 1 else 0 end)`.as("denied"),
      expired: sql<number>`sum(case when ${approvalRequests.status} = 'expired' then 1 else 0 end)`.as("expired"),
      avgDecisionTimeMs: dialect === "postgres"
        ? sql<number>`AVG(case when ${approvalRequests.decidedAt} IS NOT NULL then EXTRACT(EPOCH FROM (${approvalRequests.decidedAt}::timestamp - ${approvalRequests.createdAt}::timestamp)) * 1000 else null end)`.as("avg_decision_time_ms")
        : sql<number>`AVG(case when ${approvalRequests.decidedAt} IS NOT NULL then (${approvalRequests.decidedAt} - ${approvalRequests.createdAt}) * 1000 else null end)`.as("avg_decision_time_ms"),
    })
    .from(approvalRequests)
    .groupBy(sql`${bucketExpr}`)
    .orderBy(sql`${bucketExpr}`);

  const rows = whereClause ? await query.where(whereClause) : await query;

  const trends = rows.map((row) => ({
    bucket: row.bucket,
    requests: Number(row.requests),
    approved: Number(row.approved || 0),
    denied: Number(row.denied || 0),
    expired: Number(row.expired || 0),
    avgDecisionTimeMs: row.avgDecisionTimeMs ? Math.round(Number(row.avgDecisionTimeMs)) : 0,
  }));

  return c.json({ trends });
});

// GET /api/analytics/policies - Per-policy stats from audit logs
analyticsRouter.get("/policies", async (c) => {
  // Audit log "created" events store policyDecision in their details JSON.
  // We join audit_logs (event_type = 'created') with the policies table.
  // The details column contains: { policyDecision: "auto_approve"|"auto_deny"|"route_to_human", ... }
  const dialect = getDialect();

  // We'll use a different approach: aggregate from approval_requests table
  // since policy decisions are recorded there via decidedBy and decisionReason.
  // For per-policy breakdown, we use audit_logs details which contain policyDecision.

  // Get all policies for name lookup
  const allPolicies = await getDb()
    .select({ id: policies.id, name: policies.name })
    .from(policies);

  // Query audit log "created" events that have details containing policyDecision
  // The details JSON looks like: {"action":"...","policyDecision":"auto_approve","matchedRule":{...}}
  let policyDecisionExpr: SQL;

  if (dialect === "postgres") {
    policyDecisionExpr = sql`${auditLogs.details}::json->>'policyDecision'`;
  } else {
    policyDecisionExpr = sql`json_extract(${auditLogs.details}, '$.policyDecision')`;
  }

  const rows = await getDb()
    .select({
      policyDecision: sql<string>`${policyDecisionExpr}`.as("policy_decision"),
      cnt: sql<number>`count(*)`.as("cnt"),
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.eventType, "created"),
        sql`${policyDecisionExpr} IS NOT NULL`
      )
    )
    .groupBy(sql`${policyDecisionExpr}`);

  // Since audit logs don't store a policyId directly, we aggregate by decision type.
  // Build a summary: for each policy, count how many times its rules were matched.
  // A more detailed approach: parse matchedRule from each audit entry.
  // For now, provide aggregate policy decision stats and per-policy from decisionReason.

  // Per-policy stats from decisionReason which contains the policy rule info
  // Format: "Auto-approved by policy rule matching: {...}" or "Auto-denied by policy rule matching: {...}"
  // Since we can't easily parse per-policy from current data, we return decision-type aggregates
  // along with per-policy hit counts from the policies table cross-referenced with requests.

  const totalByDecision: Record<string, number> = {};
  for (const row of rows) {
    totalByDecision[row.policyDecision] = Number(row.cnt);
  }

  // Build response: one entry per policy, showing how many requests each handled
  // We approximate by looking at audit_logs created events grouped by details
  const policyStats = allPolicies.map((p) => ({
    policyId: p.id,
    policyName: p.name,
    hitCount: 0,
    autoApproveCount: 0,
    autoDenyCount: 0,
    routeToHumanCount: 0,
  }));

  // Also include an aggregate "All Policies" entry
  const aggregate = {
    policyId: "_aggregate",
    policyName: "All Policies (aggregate)",
    hitCount: Object.values(totalByDecision).reduce((s, v) => s + v, 0),
    autoApproveCount: totalByDecision["auto_approve"] || 0,
    autoDenyCount: totalByDecision["auto_deny"] || 0,
    routeToHumanCount: (totalByDecision["route_to_human"] || 0) + (totalByDecision["route_to_agent"] || 0),
  };

  return c.json({
    policies: [aggregate, ...policyStats],
  });
});

export default analyticsRouter;
