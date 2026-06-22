/**
 * Per-agent spend reads from AgentLens (#13) — lib/agent-spend + GET /:id/spend.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";

import {
  fetchAgentSpend,
  currentMonthWindow,
  clearSpendCache,
  SpendNotConfiguredError,
} from "../lib/agent-spend.js";
import agentsRouter from "../routes/agents.js";
import { parseConfig, setConfig, resetConfig } from "../config.js";

const CONFIGURED = { agentlensUrl: "https://lens.example", agentgateServiceToken: "svc-token" };

function mockFetch(body: unknown, ok = true) {
  const fn = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body, text: async () => "" }) as Response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  clearSpendCache();
  setConfig(parseConfig(CONFIGURED));
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetConfig();
});

describe("currentMonthWindow", () => {
  it("anchors `from` at the 1st of the month in UTC", () => {
    const w = currentMonthWindow(new Date("2026-06-17T13:45:00Z"));
    expect(w.from).toBe("2026-06-01T00:00:00.000Z");
    expect(w.to).toBe("2026-06-17T13:45:00.000Z");
  });
});

describe("fetchAgentSpend", () => {
  it("throws SpendNotConfiguredError when AgentLens isn't configured", async () => {
    setConfig(parseConfig({})); // no url/token
    await expect(fetchAgentSpend(["agt_a"], "default")).rejects.toBeInstanceOf(SpendNotConfiguredError);
  });

  it("returns a spend map, defaulting agents AgentLens omits to 0", async () => {
    mockFetch({ spend: [{ agentId: "agt_a", totalCostUsd: 12.5, lastEventAt: null }] });
    const m = await fetchAgentSpend(["agt_a", "agt_b"], "default");
    expect(m.get("agt_a")).toBe(12.5);
    expect(m.get("agt_b")).toBe(0); // not in response → 0
  });

  it("POSTs agentIds/tenantId/window to /api/internal/spend with the service token", async () => {
    const fn = mockFetch({ spend: [] });
    await fetchAgentSpend(["agt_a"], "tenant-x", { from: "2026-06-01T00:00:00Z", to: "2026-06-30T00:00:00Z" });
    const [url, init] = fn.mock.calls[0]!;
    expect(String(url)).toBe("https://lens.example/api/internal/spend");
    expect((init as { method: string }).method).toBe("POST");
    expect((init as { headers: Record<string, string> }).headers["Authorization"]).toBe("Bearer svc-token");
    expect(JSON.parse((init as { body: string }).body)).toMatchObject({ agentIds: ["agt_a"], tenantId: "tenant-x" });
  });

  it("caches within the TTL (one fetch for repeated identical reads)", async () => {
    const fn = mockFetch({ spend: [{ agentId: "agt_a", totalCostUsd: 1, lastEventAt: null }] });
    await fetchAgentSpend(["agt_a"], "default");
    await fetchAgentSpend(["agt_a"], "default");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("times out the spend read at spendReadTimeoutMs", async () => {
    setConfig(parseConfig({ ...CONFIGURED, spendReadTimeoutMs: 100 })); // min allowed
    // Honor the AbortSignal so the request rejects when the timeout fires.
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
        const sig = init?.signal;
        if (sig?.aborted) return reject(new Error("aborted"));
        sig?.addEventListener("abort", () => reject(new Error("aborted")));
      })),
    );
    await expect(fetchAgentSpend(["agt_a"], "default")).rejects.toThrow();
  });

  it("re-fetches when the cached entry is older than maxAgeMs", async () => {
    expect(new Date("2026-06-15T12:00:00.000Z").getTime() % 30_000).toBe(0); // guard: bucket-aligned
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z")); // 30s-aligned → same cache bucket below
    const fn = mockFetch({ spend: [{ agentId: "agt_a", totalCostUsd: 1, lastEventAt: null }] });
    await fetchAgentSpend(["agt_a"], "default"); // fetch #1
    vi.advanceTimersByTime(3000); // 3s later
    await fetchAgentSpend(["agt_a"], "default", undefined, 2000); // 3s > 2s maxAge → fetch #2
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("reuses a cache entry younger than maxAgeMs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
    const fn = mockFetch({ spend: [{ agentId: "agt_a", totalCostUsd: 1, lastEventAt: null }] });
    await fetchAgentSpend(["agt_a"], "default"); // fetch #1
    vi.advanceTimersByTime(1000); // 1s later
    await fetchAgentSpend(["agt_a"], "default", undefined, 2000); // 1s < 2s maxAge → cached
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("GET /api/agents/:id/spend", () => {
  function app() {
    const a = new Hono();
    a.use("*", async (c, next) => {
      c.set("auth", { identity: { type: "api_key" }, tenantId: "default", permissions: ["*"] } as never);
      await next();
    });
    a.route("/api/agents", agentsRouter);
    return a;
  }

  it("returns the agent's current-month spend", async () => {
    mockFetch({ spend: [{ agentId: "agt_a", totalCostUsd: 7.25, lastEventAt: null }] });
    const res = await app().request("/api/agents/agt_a/spend");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agentId: string; periodSpendUsd: number };
    expect(body.agentId).toBe("agt_a");
    expect(body.periodSpendUsd).toBe(7.25);
  });

  it("503s when AgentLens isn't configured", async () => {
    setConfig(parseConfig({}));
    const res = await app().request("/api/agents/agt_a/spend");
    expect(res.status).toBe(503);
  });

  it("502s on an AgentLens upstream error", async () => {
    mockFetch({ error: "boom" }, false);
    const res = await app().request("/api/agents/agt_a/spend");
    expect(res.status).toBe(502);
  });
});
