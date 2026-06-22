// @agentgate/server - API key management helpers

import { createHash, randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { eq, and, isNull } from "drizzle-orm";
import { getDb, apiKeys, type ApiKey } from "../db/index.js";
import { getConfig } from "../config.js";
import { getLogger } from "./logger.js";

// --- LRU Cache for API key validation ---
interface CacheEntry {
  apiKey: ApiKey;
  cachedAt: number; // ms
}

const apiKeyCache = new Map<string, CacheEntry>();

/**
 * Evict oldest entry when cache exceeds max size (simple LRU via insertion order).
 */
function evictIfNeeded(): void {
  const maxSize = getConfig().apiKeyCacheMaxSize;
  while (apiKeyCache.size > maxSize) {
    // Map iteration order = insertion order; first key is oldest
    const oldest = apiKeyCache.keys().next().value;
    if (oldest) apiKeyCache.delete(oldest);
    else break;
  }
}

/**
 * Invalidate a cached API key entry by its hash.
 */
export function invalidateApiKeyCache(keyHash: string): void {
  apiKeyCache.delete(keyHash);
}

/**
 * Clear the entire API key cache (for testing).
 */
export function clearApiKeyCache(): void {
  apiKeyCache.clear();
}

/**
 * Get current cache size (for testing).
 */
export function getApiKeyCacheSize(): number {
  return apiKeyCache.size;
}

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
  await Promise.all(
    entries.map(([id, timestamp]) =>
      db.update(apiKeys).set({ lastUsedAt: timestamp }).where(eq(apiKeys.id, id))
    )
  );
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
 * @param agentId - Bind this key to an agent (agt_*); null = any agent (legacy)
 * @returns { id, key } - key is shown once to user
 */
export async function createApiKey(
  name: string,
  scopes: string[],
  rateLimit: number | null = null,
  agentId: string | null = null
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
    agentId,
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
  const now = Date.now();
  const ttlMs = getConfig().apiKeyCacheTtlSec * 1000;

  // Check cache first
  const cached = apiKeyCache.get(hash);
  if (cached && (now - cached.cachedAt) < ttlMs) {
    // Re-insert to refresh LRU position
    apiKeyCache.delete(hash);
    apiKeyCache.set(hash, cached);
    // Buffer lastUsedAt
    lastUsedBuffer.set(cached.apiKey.id, Math.floor(now / 1000));
    return cached.apiKey;
  }

  // Cache miss or expired — query DB
  if (cached) apiKeyCache.delete(hash); // expired

  const results = await getDb()
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);

  const apiKey = results[0];
  if (!apiKey) {
    return null;
  }

  // Add to cache (evict if needed)
  evictIfNeeded();
  apiKeyCache.set(hash, { apiKey, cachedAt: now });

  // Buffer lastUsedAt — flushed periodically by startLastUsedFlusher()
  lastUsedBuffer.set(apiKey.id, Math.floor(now / 1000));

  return apiKey;
}

/**
 * Revoke an API key
 * @param id - The API key ID to revoke
 */
export async function revokeApiKey(id: string): Promise<void> {
  // Find the key hash to invalidate cache
  const results = await getDb()
    .select({ keyHash: apiKeys.keyHash })
    .from(apiKeys)
    .where(eq(apiKeys.id, id))
    .limit(1);

  await getDb()
    .update(apiKeys)
    .set({ revokedAt: Math.floor(Date.now() / 1000) })
    .where(eq(apiKeys.id, id));

  // Invalidate cache entry
  if (results[0]) {
    invalidateApiKeyCache(results[0].keyHash);
  }
}
