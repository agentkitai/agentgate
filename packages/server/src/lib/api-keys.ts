// @agentgate/server - API key management helpers

import { createHash, randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { eq, and, isNull } from "drizzle-orm";
import { db, apiKeys, type ApiKey } from "../db/index.js";

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

  await db.insert(apiKeys).values({
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

  const results = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);

  const apiKey = results[0];
  if (!apiKey) {
    return null;
  }

  // Update last_used_at
  await db
    .update(apiKeys)
    .set({ lastUsedAt: Math.floor(Date.now() / 1000) })
    .where(eq(apiKeys.id, apiKey.id));

  return apiKey;
}

/**
 * Revoke an API key
 * @param id - The API key ID to revoke
 */
export async function revokeApiKey(id: string): Promise<void> {
  await db
    .update(apiKeys)
    .set({ revokedAt: Math.floor(Date.now() / 1000) })
    .where(eq(apiKeys.id, id));
}
