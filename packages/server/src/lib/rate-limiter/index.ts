// @agentgate/server - Rate limiter module

export type { RateLimiter, RateLimitResult, RateLimiterBackend } from "./types.js";
export { InMemoryRateLimiter } from "./memory.js";
export { RedisRateLimiter } from "./redis.js";

import type { RateLimiter, RateLimiterBackend } from "./types.js";
import { InMemoryRateLimiter } from "./memory.js";
import { RedisRateLimiter } from "./redis.js";

// Singleton rate limiter instance
let rateLimiterInstance: RateLimiter | null = null;

/**
 * Create a rate limiter based on backend configuration
 */
export function createRateLimiter(
  backend: RateLimiterBackend,
  redisUrl?: string
): RateLimiter {
  if (backend === "redis") {
    if (!redisUrl) {
      console.warn(
        "[RateLimiter] REDIS_URL not set, falling back to in-memory backend"
      );
      return new InMemoryRateLimiter();
    }
    return new RedisRateLimiter(redisUrl);
  }

  return new InMemoryRateLimiter();
}

/**
 * Get the global rate limiter instance (lazy-loaded)
 */
export function getRateLimiter(
  backend: RateLimiterBackend = "memory",
  redisUrl?: string
): RateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = createRateLimiter(backend, redisUrl);
  }
  return rateLimiterInstance;
}

/**
 * Set the global rate limiter instance (for testing)
 */
export function setRateLimiter(limiter: RateLimiter): void {
  rateLimiterInstance = limiter;
}

/**
 * Reset the global rate limiter instance (for testing/shutdown)
 */
export async function resetRateLimiter(): Promise<void> {
  if (rateLimiterInstance) {
    await rateLimiterInstance.shutdown();
    rateLimiterInstance = null;
  }
}

// Legacy exports for backwards compatibility
// These wrap the singleton instance

/**
 * @deprecated Use getRateLimiter().checkLimit() instead
 */
export async function checkRateLimit(
  apiKeyId: string,
  limit: number | null
): Promise<import("./types.js").RateLimitResult> {
  const limiter = getRateLimiter();
  return limiter.checkLimit(apiKeyId, limit);
}

/**
 * @deprecated Use getRateLimiter().reset() instead
 */
export async function resetRateLimit(apiKeyId: string): Promise<void> {
  const limiter = getRateLimiter();
  return limiter.reset(apiKeyId);
}

/**
 * @deprecated Use getRateLimiter().clearAll() instead
 */
export async function clearAllRateLimits(): Promise<void> {
  const limiter = getRateLimiter();
  return limiter.clearAll();
}

/**
 * @deprecated Use resetRateLimiter() instead
 */
export async function stopCleanup(): Promise<void> {
  return resetRateLimiter();
}
