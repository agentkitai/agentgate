/**
 * Tests for PERF-001: API Key Cache + Batch lastUsedAt
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { createHash, randomBytes } from "node:crypto";
import * as schema from "../db/schema.js";

const { apiKeys } = schema;

const sqlite = new Database(":memory:");
const db = drizzle(sqlite, { schema });

sqlite.exec(`
CREATE TABLE IF NOT EXISTS api_keys (
  id text PRIMARY KEY NOT NULL,
  key_hash text NOT NULL,
  name text NOT NULL,
  scopes text NOT NULL,
  created_at integer NOT NULL,
  last_used_at integer,
  revoked_at integer,
  rate_limit integer,
  agent_id text
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
`);

// Track DB calls via spy
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
  apiKeys: schema.apiKeys,
}));

vi.mock("../config.js", () => ({
  getConfig: () => ({
    apiKeyCacheTtlSec: 60,
    apiKeyCacheMaxSize: 1000,
  }),
}));

vi.mock("./logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  validateApiKey,
  hashApiKey,
  invalidateApiKeyCache,
  clearApiKeyCache,
  getApiKeyCacheSize,
} from "../lib/api-keys.js";

afterAll(() => sqlite.close());

function createTestKey(): { id: string; key: string; hash: string } {
  const id = nanoid();
  const key = `agk_${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(key).digest("hex");
  return { id, key, hash };
}

describe("API Key Cache", () => {
  beforeEach(async () => {
    sqlite.exec("DELETE FROM api_keys");
    clearApiKeyCache();
    selectSpy.mockClear();
  });

  it("cache hit avoids DB query", async () => {
    const { id, key, hash } = createTestKey();
    await db.insert(apiKeys).values({
      id,
      keyHash: hash,
      name: "test",
      scopes: '["admin"]',
      createdAt: Math.floor(Date.now() / 1000),
    });

    // First call → DB hit
    const result1 = await validateApiKey(key);
    expect(result1).not.toBeNull();
    expect(result1!.id).toBe(id);
    const dbCallsAfterFirst = selectSpy.mock.calls.length;

    // Second call → cache hit, no additional DB call
    const result2 = await validateApiKey(key);
    expect(result2).not.toBeNull();
    expect(result2!.id).toBe(id);
    expect(selectSpy.mock.calls.length).toBe(dbCallsAfterFirst);
  });

  it("cache miss queries DB", async () => {
    const { key } = createTestKey();

    // Key doesn't exist in DB
    const result = await validateApiKey(key);
    expect(result).toBeNull();
    expect(selectSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it("revocation invalidates cache entry", async () => {
    const { id, key, hash } = createTestKey();
    await db.insert(apiKeys).values({
      id,
      keyHash: hash,
      name: "test",
      scopes: '["admin"]',
      createdAt: Math.floor(Date.now() / 1000),
    });

    // Populate cache
    await validateApiKey(key);
    expect(getApiKeyCacheSize()).toBe(1);

    // Invalidate
    invalidateApiKeyCache(hash);
    expect(getApiKeyCacheSize()).toBe(0);

    // Next call should hit DB again
    selectSpy.mockClear();
    await validateApiKey(key);
    expect(selectSpy.mock.calls.length).toBeGreaterThan(0);
  });
});
