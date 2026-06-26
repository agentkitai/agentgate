/**
 * Per-agent eval gate read + verdict (#7). checkAgentEval reads an agent's latest
 * eval pass-rate from AgentLens and decides allow/deny; it must FAIL OPEN.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkAgentEval, clearEvalCache } from "../lib/agent-eval.js";
import { parseConfig, setConfig, resetConfig } from "../config.js";

const LENS = { agentlensUrl: "https://lens.example", agentgateServiceToken: "svc", agentEvalMinPassRate: 0.8 };

function mockStatus(resp: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => resp }) as Response),
  );
}

beforeEach(() => {
  clearEvalCache();
  setConfig(parseConfig(LENS));
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetConfig();
});

describe("checkAgentEval (#7)", () => {
  it("allows when the latest pass-rate is at/above the minimum", async () => {
    mockStatus({ found: true, passRate: 0.9 });
    const v = await checkAgentEval("agt_a", "default");
    expect(v.allowed).toBe(true);
    expect(v.passRate).toBe(0.9);
    expect(v.minPassRate).toBe(0.8);
  });

  it("denies when the latest pass-rate is below the minimum", async () => {
    mockStatus({ found: true, passRate: 0.5 });
    expect((await checkAgentEval("agt_a", "default")).allowed).toBe(false);
  });

  it("allows an agent with no eval evidence yet (found:false)", async () => {
    mockStatus({ found: false });
    expect((await checkAgentEval("agt_a", "default")).allowed).toBe(true);
  });

  it("fails open when AgentLens is not configured", async () => {
    setConfig(parseConfig({ agentEvalMinPassRate: 0.8 })); // no url/token
    clearEvalCache();
    expect((await checkAgentEval("agt_a", "default")).allowed).toBe(true);
  });

  it("fails open when the eval-status read errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect((await checkAgentEval("agt_a", "default")).allowed).toBe(true);
  });

  it("respects a custom minimum pass-rate", async () => {
    setConfig(parseConfig({ ...LENS, agentEvalMinPassRate: 0.4 }));
    clearEvalCache();
    mockStatus({ found: true, passRate: 0.5 });
    expect((await checkAgentEval("agt_a", "default")).allowed).toBe(true);
  });
});
