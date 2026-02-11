/**
 * Tests for PERF-003: Parallel webhook delivery.
 * Verifies that deliverWebhook() fires all webhooks concurrently via Promise.allSettled().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";

const { webhooks, webhookDeliveries } = schema;

vi.mock("../db/index.js", () => ({
  getDb: vi.fn(),
}));

vi.mock("../config.js", () => ({
  getConfig: () => ({ webhookEncryptionKey: null, webhookTimeoutMs: 5000, logLevel: "silent", logFormat: "json" }),
  parseConfig: (o: any) => o,
  setConfig: () => {},
  resetConfig: () => {},
}));

vi.mock("../lib/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock("../lib/url-validator.js", () => ({
  validateWebhookUrl: () => Promise.resolve({ valid: true, resolvedIP: "93.184.216.34" }),
}));

vi.mock("../lib/crypto.js", () => ({
  decrypt: vi.fn((s: string) => s),
  encrypt: vi.fn((s: string) => s),
  isEncrypted: vi.fn(() => false),
  deriveKey: vi.fn(() => "key"),
}));

import { getDb } from "../db/index.js";
import { deliverWebhook } from "../lib/webhook.js";

const MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS webhooks (
  id text PRIMARY KEY NOT NULL,
  url text NOT NULL,
  secret text NOT NULL,
  events text NOT NULL,
  enabled integer DEFAULT 1 NOT NULL,
  created_at integer NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id text PRIMARY KEY NOT NULL,
  webhook_id text NOT NULL,
  event text NOT NULL,
  payload text NOT NULL,
  status text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  last_attempt_at integer,
  response_code integer,
  response_body text
);
`;

let sqlite: InstanceType<typeof Database>;
let db: ReturnType<typeof drizzle>;

function setupDb() {
  sqlite = new Database(":memory:");
  db = drizzle(sqlite, { schema });
  for (const statement of MIGRATIONS_SQL.split(";")) {
    const trimmed = statement.trim();
    if (trimmed) sqlite.exec(trimmed);
  }
  (getDb as any).mockReturnValue(db);
}

describe("PERF-003: Parallel webhook delivery", () => {
  beforeEach(() => {
    setupDb();
  });

  afterEach(() => {
    sqlite.close();
    vi.restoreAllMocks();
  });

  it("delivers to 3 webhooks in parallel (total < 400ms with 200ms delay each)", async () => {
    const DELAY_MS = 200;

    // Insert 3 webhooks
    for (let i = 1; i <= 3; i++) {
      await db.insert(webhooks).values({
        id: `wh-${i}`,
        url: `https://example.com/hook${i}`,
        secret: "test-secret",
        events: JSON.stringify(["test.event"]),
        enabled: 1,
        createdAt: Date.now(),
      });
    }

    // Mock fetch with 200ms delay
    const mockFetch = vi.fn().mockImplementation(() =>
      new Promise((resolve) =>
        setTimeout(() => resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve("OK"),
        }), DELAY_MS)
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const start = performance.now();
    await deliverWebhook("test.event", { foo: "bar" });
    const elapsed = performance.now() - start;

    // Should be parallel: ~200ms, not ~600ms
    expect(elapsed).toBeLessThan(400);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // All 3 deliveries recorded
    const deliveries = await db.select().from(webhookDeliveries);
    expect(deliveries).toHaveLength(3);
    for (const d of deliveries) {
      expect(d.status).toBe("success");
      expect(d.attempts).toBe(1);
    }
  });

  it("individual failure doesn't block other deliveries", async () => {
    // Insert 3 webhooks
    for (let i = 1; i <= 3; i++) {
      await db.insert(webhooks).values({
        id: `wh-${i}`,
        url: `https://example.com/hook${i}`,
        secret: "test-secret",
        events: JSON.stringify(["test.event"]),
        enabled: 1,
        createdAt: Date.now(),
      });
    }

    // First hook fails, others succeed
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error("connection refused"));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve("OK"),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    await deliverWebhook("test.event", { data: 1 });

    expect(mockFetch).toHaveBeenCalledTimes(3);

    const deliveries = await db.select().from(webhookDeliveries);
    expect(deliveries).toHaveLength(3);

    const statuses = deliveries.map((d) => d.status).sort();
    // 1 pending (failed first attempt, retryable) + 2 success
    expect(statuses).toEqual(["pending", "success", "success"]);
  });
});
