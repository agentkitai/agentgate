import { describe, it, expect, beforeEach } from "vitest";
import app from "../../index.js";
import { resetMetrics, approvalRequestsTotal, registry } from "../../lib/metrics.js";

describe("Prometheus Metrics - GET /metrics", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("should return Prometheus text format", async () => {
    const res = await app.request("/metrics");
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") || "";
    expect(contentType).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("http_requests_total");
    expect(body).toContain("http_request_duration_seconds");
  });

  it("should expose business metrics", async () => {
    const res = await app.request("/metrics");
    const body = await res.text();
    // Metrics should be registered (may show 0)
    expect(body).toContain("agentgate_approval_requests_total");
    expect(body).toContain("agentgate_decision_latency_seconds");
    expect(body).toContain("agentgate_active_requests");
  });

  it("should increment counters after requests", async () => {
    // Increment a business metric manually
    approvalRequestsTotal.inc({ status: "pending" });
    
    const res = await app.request("/metrics");
    const body = await res.text();
    expect(body).toContain('agentgate_approval_requests_total{status="pending"} 1');
  });

  it("should not require auth", async () => {
    const res = await app.request("/metrics");
    expect(res.status).toBe(200);
  });
});
