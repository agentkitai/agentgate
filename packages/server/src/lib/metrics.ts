/**
 * Prometheus metrics for AgentGate.
 *
 * Business metrics:
 *   agentgate_approval_requests_total  (counter, by status)
 *   agentgate_decision_latency_seconds (histogram)
 *   agentgate_notification_delivery_total (counter, by channel+status)
 *   agentgate_policy_evaluation_seconds (histogram)
 *   agentgate_webhook_delivery_total   (counter, by status)
 *   agentgate_active_requests          (gauge)
 *
 * HTTP RED metrics:
 *   http_requests_total           (counter, by method+route+status)
 *   http_request_duration_seconds (histogram, by method+route+status)
 */

import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from "prom-client";

// Singleton registry
export const registry = new Registry();

// Collect Node.js default metrics (GC, event loop, etc.)
collectDefaultMetrics({ register: registry });

// ── Business metrics ───────────────────────────────────────────

export const approvalRequestsTotal = new Counter({
  name: "agentgate_approval_requests_total",
  help: "Total approval requests by status",
  labelNames: ["status"] as const,
  registers: [registry],
});

export const decisionLatency = new Histogram({
  name: "agentgate_decision_latency_seconds",
  help: "Time from request creation to decision",
  buckets: [0.1, 0.5, 1, 5, 15, 60, 300],
  registers: [registry],
});

export const notificationDeliveryTotal = new Counter({
  name: "agentgate_notification_delivery_total",
  help: "Notification deliveries by channel and status",
  labelNames: ["channel", "status"] as const,
  registers: [registry],
});

export const policyEvaluation = new Histogram({
  name: "agentgate_policy_evaluation_seconds",
  help: "Policy evaluation duration",
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5],
  registers: [registry],
});

export const webhookDeliveryTotal = new Counter({
  name: "agentgate_webhook_delivery_total",
  help: "Webhook deliveries by status",
  labelNames: ["status"] as const,
  registers: [registry],
});

export const activeRequests = new Gauge({
  name: "agentgate_active_requests",
  help: "Currently pending approval requests",
  registers: [registry],
});

// ── HTTP RED metrics ───────────────────────────────────────────

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

/**
 * Reset all metrics (for testing).
 */
export function resetMetrics(): void {
  registry.resetMetrics();
}
