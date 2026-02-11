/**
 * Tests for PERF-002: Policy Cache
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import * as schema from "../db/schema.js";

const { policies } = schema;

const sqlite = new Database(":memory:");
const db = drizzle(sqlite, { schema });

sqlite.exec(`
CREATE TABLE IF NOT EXISTS policies (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  rules text NOT NULL,
  priority integer NOT NULL,
  enabled integer NOT NULL,
  created_at integer NOT NULL
);
`);

// Track DB select calls via spy
const selectSpy = vi.fn();
const originalSelect = db.select.bind(db);

const dbProxy = new Proxy(db, {
  get(target, prop) {
    if (prop === "select") {
      selectSpy();
      return originalSelect;
    }
    return (target as any)[prop];
  },
});

vi.mock("../db/index.js", () => ({
  getDb: () => dbProxy,
  policies: schema.policies,
}));

// Now import the module under test (after mocks are set up)
const { getCachedPolicies, invalidatePolicyCache } = await import("../lib/policy-cache.js");

function insertPolicy(id: string, name: string, priority: number, rules: object[] = [], enabled = true) {
  sqlite.exec(
    `INSERT INTO policies (id, name, rules, priority, enabled, created_at) VALUES ('${id}', '${name}', '${JSON.stringify(rules)}', ${priority}, ${enabled ? 1 : 0}, ${Date.now()})`
  );
}

describe("Policy Cache (PERF-002)", () => {
  beforeEach(() => {
    sqlite.exec("DELETE FROM policies");
    invalidatePolicyCache();
    selectSpy.mockClear();
  });

  afterAll(() => {
    sqlite.close();
  });

  it("AC1: caches policies after first load — second call skips DB", async () => {
    insertPolicy("p1", "Policy 1", 10, [{ match: { action: "test" }, decision: "auto_approve" }]);

    const first = await getCachedPolicies();
    expect(first).toHaveLength(1);
    expect(selectSpy).toHaveBeenCalledTimes(1);

    const second = await getCachedPolicies();
    expect(second).toHaveLength(1);
    expect(selectSpy).toHaveBeenCalledTimes(1); // no additional DB call
  });

  it("AC2/AC3: invalidatePolicyCache forces reload from DB", async () => {
    insertPolicy("p1", "Policy 1", 10);

    await getCachedPolicies();
    expect(selectSpy).toHaveBeenCalledTimes(1);

    // Add another policy directly to DB
    insertPolicy("p2", "Policy 2", 20);
    invalidatePolicyCache();

    const result = await getCachedPolicies();
    expect(selectSpy).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
  });

  it("AC4: cache stores parsed, priority-sorted policies", async () => {
    const rules = [{ match: { action: "deploy" }, decision: "auto_deny" }];
    insertPolicy("p-high", "High Priority", 50, rules);
    insertPolicy("p-low", "Low Priority", 1, rules);
    insertPolicy("p-mid", "Mid Priority", 25, rules);

    const result = await getCachedPolicies();

    // Should be sorted by priority ascending
    expect(result[0]!.name).toBe("Low Priority");
    expect(result[1]!.name).toBe("Mid Priority");
    expect(result[2]!.name).toBe("High Priority");

    // Should be parsed objects, not JSON strings
    expect(typeof result[0]!.rules[0]).toBe("object");
    expect(result[0]!.rules[0].decision).toBe("auto_deny");
  });

  it("AC5: multiple invalidations work correctly", async () => {
    insertPolicy("p1", "Policy 1", 10);

    await getCachedPolicies();
    invalidatePolicyCache();
    invalidatePolicyCache(); // double invalidation is safe

    await getCachedPolicies();
    expect(selectSpy).toHaveBeenCalledTimes(2);
  });

  it("concurrent cache misses result in only 1 DB call (promise coalescing)", async () => {
    insertPolicy("p1", "Policy 1", 10, [{ match: { action: "test" }, decision: "auto_approve" }]);

    const [a, b] = await Promise.all([getCachedPolicies(), getCachedPolicies()]);
    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a).toBe(b); // same reference
  });

  it("skips policies with malformed JSON rules without crashing", async () => {
    insertPolicy("p1", "Good Policy", 10, [{ match: { action: "test" }, decision: "auto_approve" }]);
    // Insert malformed rules directly
    sqlite.exec(
      `INSERT INTO policies (id, name, rules, priority, enabled, created_at) VALUES ('p-bad', 'Bad Policy', 'not-json{{{', 20, 1, ${Date.now()})`
    );
    insertPolicy("p3", "Another Good", 30, [{ match: { action: "deploy" }, decision: "auto_deny" }]);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await getCachedPolicies();
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("Good Policy");
    expect(result[1]!.name).toBe("Another Good");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("returns empty array when no policies exist", async () => {
    const result = await getCachedPolicies();
    expect(result).toEqual([]);
    expect(selectSpy).toHaveBeenCalledTimes(1);

    // Empty result is still cached
    const second = await getCachedPolicies();
    expect(second).toEqual([]);
    expect(selectSpy).toHaveBeenCalledTimes(1);
  });
});
