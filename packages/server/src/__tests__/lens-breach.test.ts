/**
 * Mirror guardrail breaches into AgentLens (#55, gate→lens wedge) — lib/lens-breach.
 *
 * The key guarantees: fire-and-forget + FAIL-OPEN (never throws), no-op when
 * AgentLens isn't configured or no session is supplied, and the right body/auth
 * when it is.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { notifyLensOfBreach, sessionIdFromContext } from "../lib/lens-breach.js";
import { parseConfig, setConfig, resetConfig } from "../config.js";

const CONFIGURED = { agentlensUrl: "https://lens.example", agentgateServiceToken: "svc-token" };

function mockFetch(ok = true) {
  const fn = vi.fn(async () => ({ ok, status: ok ? 201 : 500, json: async () => ({}), text: async () => "" }) as Response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

const base = { sessionId: "sess-1", agentId: "agt_a", ruleId: "no_delete", source: "mcp_guardrail" };

beforeEach(() => setConfig(parseConfig(CONFIGURED)));
afterEach(() => {
  vi.unstubAllGlobals();
  resetConfig();
});

describe("sessionIdFromContext", () => {
  it("extracts a string session id, else undefined", () => {
    expect(sessionIdFromContext({ agentlens_session_id: "s1" })).toBe("s1");
    expect(sessionIdFromContext({ agentlens_session_id: "" })).toBeUndefined();
    expect(sessionIdFromContext({ agentlens_session_id: 123 })).toBeUndefined();
    expect(sessionIdFromContext({})).toBeUndefined();
    expect(sessionIdFromContext(undefined)).toBeUndefined();
  });
});

describe("notifyLensOfBreach", () => {
  it("POSTs to /api/internal/eval/guardrail-breach with the service token + breach body", async () => {
    const fn = mockFetch();
    const ok = await notifyLensOfBreach({ ...base, tool: "delete_db", reason: "blocked" });
    expect(ok).toBe(true);
    const [url, init] = fn.mock.calls[0]!;
    expect(String(url)).toBe("https://lens.example/api/internal/eval/guardrail-breach");
    expect((init as { method: string }).method).toBe("POST");
    expect((init as { headers: Record<string, string> }).headers["Authorization"]).toBe("Bearer svc-token");
    expect(JSON.parse((init as { body: string }).body)).toMatchObject({
      tenantId: "default",
      sessionId: "sess-1",
      agentId: "agt_a",
      breach: { ruleId: "no_delete", tool: "delete_db", reason: "blocked", source: "mcp_guardrail" },
    });
  });

  it("no-ops (no fetch) when AgentLens isn't configured", async () => {
    setConfig(parseConfig({})); // no url/token
    const fn = mockFetch();
    expect(await notifyLensOfBreach(base)).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("no-ops (no fetch) when no sessionId is supplied", async () => {
    const fn = mockFetch();
    expect(await notifyLensOfBreach({ ...base, sessionId: "" })).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("fails open — never throws when AgentLens errors", async () => {
    mockFetch(false); // non-200 → AgentGateHttpClient throws → swallowed
    await expect(notifyLensOfBreach(base)).resolves.toBe(false);
  });

  it("fails open — never throws when fetch itself rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await expect(notifyLensOfBreach(base)).resolves.toBe(false);
  });

  it("fails open — never throws when a 2xx response has an unparseable body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 201,
      json: async () => { throw new SyntaxError("Unexpected token < in JSON"); },
      text: async () => "",
    }) as Response));
    await expect(notifyLensOfBreach(base)).resolves.toBe(false);
  });

  it("caps an over-long session id (treats it as absent)", () => {
    expect(sessionIdFromContext({ agentlens_session_id: "x".repeat(257) })).toBeUndefined();
    expect(sessionIdFromContext({ agentlens_session_id: "x".repeat(256) })).toBe("x".repeat(256));
  });
});
