// @agentkitai/agentgate-server - Rate limiter types and interface

/**
 * Result of a rate limit check
 */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number; // milliseconds until window resets
}

/**
 * Rate limiter interface - async for Redis support
 */
export interface RateLimiter {
  /**
   * Check if a request is allowed under the rate limit
   * @param key - The identifier to rate limit (e.g., API key ID)
   * @param limit - The rate limit (requests per minute), null = unlimited
   * @returns Promise resolving to RateLimitResult
   */
  checkLimit(key: string, limit: number | null): Promise<RateLimitResult>;

  /**
   * Reset rate limit for a specific key
   * @param key - The identifier to reset
   */
  reset(key: string): Promise<void>;

  /**
   * Clear all rate limits (for testing/maintenance)
   */
  clearAll(): Promise<void>;

  /**
   * Gracefully shut down the rate limiter
   */
  shutdown(): Promise<void>;

  /**
   * Ping the underlying store to verify connectivity
   * Returns true if healthy, throws or returns false otherwise
   */
  ping(): Promise<boolean>;
}

/**
 * Rate limiter backend type
 */
export type RateLimiterBackend = "memory" | "redis";
