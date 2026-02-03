// @agentgate/server - In-memory sliding window rate limiter

import type { RateLimiter, RateLimitResult } from "./types.js";

interface RateLimitEntry {
  timestamps: number[];
}

// Window size in milliseconds (1 minute)
const WINDOW_MS = 60 * 1000;

// Cleanup interval (5 minutes)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * In-memory rate limiter using sliding window algorithm
 */
export class InMemoryRateLimiter implements RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanup();
  }

  private startCleanup(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const cutoff = now - WINDOW_MS;

      const entries = Array.from(this.store.entries());
      for (const [key, entry] of entries) {
        // Remove old timestamps
        entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);

        // Remove entry if no timestamps left
        if (entry.timestamps.length === 0) {
          this.store.delete(key);
        }
      }
    }, CLEANUP_INTERVAL_MS);

    // Don't prevent Node from exiting
    this.cleanupInterval.unref();
  }

  async checkLimit(key: string, limit: number | null): Promise<RateLimitResult> {
    // No limit = always allowed
    if (limit === null || limit <= 0) {
      return {
        allowed: true,
        limit: 0,
        remaining: 0,
        resetMs: 0,
      };
    }

    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    // Get or create entry
    let entry = this.store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.store.set(key, entry);
    }

    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

    // Calculate remaining
    const count = entry.timestamps.length;
    const remaining = Math.max(0, limit - count);

    // Calculate reset time (when the oldest timestamp expires)
    const resetMs =
      entry.timestamps.length > 0
        ? Math.max(0, entry.timestamps[0]! + WINDOW_MS - now)
        : WINDOW_MS;

    // Check if allowed
    if (count >= limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetMs,
      };
    }

    // Record this request
    entry.timestamps.push(now);

    return {
      allowed: true,
      limit,
      remaining: remaining - 1, // -1 because we just used one
      resetMs,
    };
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clearAll(): Promise<void> {
    this.store.clear();
  }

  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
