// @agentgate/server - API key management helpers

import { createHash, randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { eq, and, isNull } from "drizzle-orm";
import { getDb, apiKeys, type ApiKey } from "../db/index.js";
import { getLogger } from "./logger.js";

// --- Batched lastUsedAt writes ---
// Buffer: apiKey.id → unix timestamp (seconds)
const lastUsedBuffer = new Map<string, number>();
let flushTimer: NodeJS.Timeout | null = null;

/**
 * Flush buffered lastUsedAt timestamps to the database.
 * Atomically swaps the buffer so concurrent writes during flush are safe.
 */
async function flushLastUsed(): Promise<void> {
  if (lastUsedBuffer.size === 0) return;
  const entries = Array.from(lastUsedBuffer.entries());
  lastUsedBuffer.clear();
  const db = getDb();
  for (const [id, timestamp] of entries) {
    await db.update(apiKeys).set({ lastUsedAt: timestamp }).where(eq(apiKeys.id, id));
  }
}

/**
 * Start the periodic lastUsedAt flusher.
 * @param intervalMs - Flush interval in milliseconds (default 60s)
 */
export function startLastUsedFlusher(intervalMs = 60_000): NodeJS.Timeout {
  flushTimer = setInterval(() => {
    flushLastUsed().catch(err => getLogger().error({ err }, 'Failed to flush lastUsedAt'));
  }, intervalMs);
  return flushTimer;
}

/**
 * Stop the periodic lastUsedAt flusher and perform a final flush.
 */
export function stopLastUsedFlusher(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  // Best-effort final flush on shutdown
  flushLastUsed().catch(() => {});
}

/**
 * Hash an API key using SHA256
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Generate a new API key and its hash
 * @returns { key, hash } - key is shown once to user, hash is stored in DB
 */
export function generateApiKey(): { key: string; hash: string } {
  // Generate a secure random key with prefix for easy identification
  const randomPart = randomBytes(32).toString("base64url");
  const key = `agk_${randomPart}`;
  const hash = hashApiKey(key);
  return { key, hash };
}

/**
 * Create a new API key in the database
 * @param name - Human-readable name for the key
 * @param scopes - Array of scopes like ["request:create", "request:read", "admin"]
 * @param rateLimit - Rate limit (requests per minute), null = unlimited
 * @returns { id, key } - key is shown once to user
 */
export async function createApiKey(
  name: string,
  scopes: string[],
  rateLimit: number | null = null
): Promise<{ id: string; key: string }> {
  const id = nanoid();
  const { key, hash } = generateApiKey();

  await getDb().insert(apiKeys).values({
    id,
    keyHash: hash,
    name,
    scopes: JSON.stringify(scopes),
    createdAt: Math.floor(Date.now() / 1000),
    rateLimit,
  });

  return { id, key };
}

/**
 * Validate an API key
 * @param key - The API key to validate
 * @returns The API key record if valid and not revoked, null otherwise
 */
export async function validateApiKey(key: string): Promise<ApiKey | null> {
  const hash = hashApiKey(key);

  const results = await getDb()
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);

  const apiKey = results[0];
  if (!apiKey) {
    return null;
  }

  // Buffer lastUsedAt — flushed periodically by startLastUsedFlusher()
  lastUsedBuffer.set(apiKey.id, Math.floor(Date.now() / 1000));

  return apiKey;
}

/**
 * Revoke an API key
 * @param id - The API key ID to revoke
 */
export async function revokeApiKey(id: string): Promise<void> {
  await getDb()
    .update(apiKeys)
    .set({ revokedAt: Math.floor(Date.now() / 1000) })
    .where(eq(apiKeys.id, id));
}
