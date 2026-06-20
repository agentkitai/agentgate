import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestContext } from "./setup.js";
import { overrides } from "../db/schema.js";
import {
  applyBreach,
  applyRecovery,
  matchRule,
  loadRulesFromEnv,
  OverrideTracker,
  type GuardrailRule,
} from "../routes/guardrails.js";

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestDb();
});

afterEach(() => {
  ctx.cleanup();
});

const RULES: GuardrailRule[] = [
  { metric: "error_rate", toolPattern: "*", ttlSeconds: 3600, reason: "Error rate high" },
  { metric: "latency_p99", toolPattern: "external_api.*", ttlSeconds: 1800 },
];

describe("reactive guardrails", () => {
  it("matchRule selects the rule for a metric", () => {
    expect(matchRule("error_rate", RULES)?.toolPattern).toBe("*");
    expect(matchRule("latency_p99", RULES)?.toolPattern).toBe("external_api.*");
    expect(matchRule("unknown_metric", RULES)).toBeUndefined();
  });

  it("loadRulesFromEnv parses a JSON array and tolerates junk", () => {
    process.env.GUARDRAILS_RULES = JSON.stringify(RULES);
    expect(loadRulesFromEnv()).toHaveLength(2);
    process.env.GUARDRAILS_RULES = "not json";
    expect(loadRulesFromEnv()).toEqual([]);
    delete process.env.GUARDRAILS_RULES;
    expect(loadRulesFromEnv()).toEqual([]);
  });

  it("breach creates a require_approval override; recovery removes it", async () => {
    const tracker = new OverrideTracker();

    const id = await applyBreach(ctx.db, RULES[0]!, "agent-1", tracker);
    let rows = await ctx.db.select().from(overrides).where(eq(overrides.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("require_approval");
    expect(rows[0]!.agentId).toBe("agent-1");
    expect(rows[0]!.toolPattern).toBe("*");
    expect(rows[0]!.reason).toBe("Error rate high");
    expect(rows[0]!.expiresAt).not.toBeNull();

    const removed = await applyRecovery(ctx.db, "agent-1", "error_rate", tracker);
    expect(removed).toBe(id);
    rows = await ctx.db.select().from(overrides).where(eq(overrides.id, id));
    expect(rows).toHaveLength(0);
  });

  it("defaults the reason when a rule omits it", async () => {
    const tracker = new OverrideTracker();
    const id = await applyBreach(ctx.db, RULES[1]!, "agent-2", tracker);
    const rows = await ctx.db.select().from(overrides).where(eq(overrides.id, id));
    expect(rows[0]!.reason).toContain("latency_p99");
  });

  it("recovery without a matching breach is a no-op", async () => {
    const tracker = new OverrideTracker();
    expect(await applyRecovery(ctx.db, "agent-x", "error_rate", tracker)).toBeNull();
  });

  it("tracks overrides per (agent, metric) independently", async () => {
    const tracker = new OverrideTracker();
    const a = await applyBreach(ctx.db, RULES[0]!, "agent-1", tracker);
    const b = await applyBreach(ctx.db, RULES[0]!, "agent-2", tracker);
    expect(a).not.toBe(b);
    expect(await applyRecovery(ctx.db, "agent-1", "error_rate", tracker)).toBe(a);
    // agent-2's override survives
    const rows = await ctx.db.select().from(overrides).where(eq(overrides.id, b));
    expect(rows).toHaveLength(1);
  });
});
