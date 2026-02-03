// @agentgate/server - Redis-backed sliding window rate limiter

import Redis from "ioredis";
import type { RateLimiter, RateLimitResult } from "./types.js";
import { InMemoryRateLimiter } from "./memory.js";

// Window size in milliseconds (1 minute)
const WINDOW_MS = 60 * 1000;

// Key prefix for rate limit entries
const KEY_PREFIX = "agentgate:ratelimit:";

/**
 * Redis-backed rate limiter using sliding window algorithm
 * Falls back to in-memory if Redis is unavailable
 */
export class RedisRateLimiter implements RateLimiter {
  private redis: Redis | null = null;
  private fallback: InMemoryRateLimiter;
  private useFallback = false;
  private connectionPromise: Promise<void> | null = null;

  constructor(redisUrl: string) {
    this.fallback = new InMemoryRateLimiter();
    this.connectionPromise = this.connect(redisUrl);
  }

  private async connect(redisUrl: string): Promise<void> {
    try {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          // Exponential backoff, max 10 seconds
          const delay = Math.min(times * 100, 10000);
          return delay;
        },
        lazyConnect: true,
      });

      // Set up error handling
      this.redis.on("error", (err) => {
        console.error("[RateLimiter] Redis error:", err.message);
        this.useFallback = true;
      });

      this.redis.on("connect", () => {
        console.log("[RateLimiter] Redis connected");
        this.useFallback = false;
      });

      this.redis.on("reconnecting", () => {
        console.log("[RateLimiter] Redis reconnecting...");
      });

      // Try to connect
      await this.redis.connect();
      this.useFallback = false;
    } catch (err) {
      console.error(
        "[RateLimiter] Redis connection failed, using fallback:",
        (err as Error).message
      );
      this.useFallback = true;
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.connectionPromise) {
      await this.connectionPromise;
      this.connectionPromise = null;
    }
  }

  async checkLimit(key: string, limit: number | null): Promise<RateLimitResult> {
    await this.ensureConnected();

    // No limit = always allowed
    if (limit === null || limit <= 0) {
      return {
        allowed: true,
        limit: 0,
        remaining: 0,
        resetMs: 0,
      };
    }

    // Use fallback if Redis is unavailable
    if (this.useFallback || !this.redis) {
      return this.fallback.checkLimit(key, limit);
    }

    const now = Date.now();
    const windowStart = now - WINDOW_MS;
    const redisKey = `${KEY_PREFIX}${key}`;

    try {
      // Use Redis sorted set for sliding window
      // Score is the timestamp, member is a unique request ID
      const multi = this.redis.multi();

      // Remove old entries outside the window
      multi.zremrangebyscore(redisKey, 0, windowStart);

      // Count current entries in the window
      multi.zcard(redisKey);

      // Get the oldest entry (for reset time calculation)
      multi.zrange(redisKey, 0, 0, "WITHSCORES");

      const results = await multi.exec();
      if (!results) {
        throw new Error("Redis multi exec returned null");
      }

      const count = results[1]?.[1] as number;
      const oldestEntry = results[2]?.[1] as string[] | undefined;

      // Calculate reset time
      let resetMs = WINDOW_MS;
      if (oldestEntry && oldestEntry.length >= 2) {
        const oldestTimestamp = parseInt(oldestEntry[1]!, 10);
        resetMs = Math.max(0, oldestTimestamp + WINDOW_MS - now);
      }

      // Calculate remaining
      const remaining = Math.max(0, limit - count);

      // Check if allowed
      if (count >= limit) {
        return {
          allowed: false,
          limit,
          remaining: 0,
          resetMs,
        };
      }

      // Add the new request with current timestamp as score
      // Use timestamp + random suffix for uniqueness
      const requestId = `${now}-${Math.random().toString(36).slice(2, 8)}`;
      await this.redis.zadd(redisKey, now, requestId);

      // Set TTL to clean up the key after the window expires
      await this.redis.pexpire(redisKey, WINDOW_MS + 1000);

      return {
        allowed: true,
        limit,
        remaining: remaining - 1,
        resetMs,
      };
    } catch (err) {
      console.error("[RateLimiter] Redis error, falling back:", (err as Error).message);
      this.useFallback = true;
      return this.fallback.checkLimit(key, limit);
    }
  }

  async reset(key: string): Promise<void> {
    await this.ensureConnected();

    // Reset in both stores for consistency
    await this.fallback.reset(key);

    if (!this.useFallback && this.redis) {
      try {
        await this.redis.del(`${KEY_PREFIX}${key}`);
      } catch (err) {
        console.error("[RateLimiter] Redis reset error:", (err as Error).message);
      }
    }
  }

  async clearAll(): Promise<void> {
    await this.ensureConnected();

    // Clear fallback
    await this.fallback.clearAll();

    if (!this.useFallback && this.redis) {
      try {
        // Find and delete all rate limit keys
        const keys = await this.redis.keys(`${KEY_PREFIX}*`);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } catch (err) {
        console.error("[RateLimiter] Redis clearAll error:", (err as Error).message);
      }
    }
  }

  async shutdown(): Promise<void> {
    await this.ensureConnected();

    // Shutdown fallback
    await this.fallback.shutdown();

    // Close Redis connection
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch {
        // Ignore errors on shutdown
      }
      this.redis = null;
    }
  }

  /**
   * Check if Redis is connected and healthy
   */
  isRedisConnected(): boolean {
    return !this.useFallback && this.redis !== null;
  }
}
