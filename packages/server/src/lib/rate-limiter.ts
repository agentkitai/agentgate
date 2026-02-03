// @agentgate/server - In-memory sliding window rate limiter

interface RateLimitEntry {
  timestamps: number[];
}

// In-memory storage for rate limit tracking
// Key is API key ID, value contains request timestamps
const rateLimitStore = new Map<string, RateLimitEntry>();

// Window size in milliseconds (1 minute)
const WINDOW_MS = 60 * 1000;

// Cleanup interval (5 minutes)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// Periodically clean up old entries to prevent memory leaks
let cleanupInterval: NodeJS.Timeout | null = null;

function startCleanup() {
  if (cleanupInterval) return;
  
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    
    for (const [key, entry] of rateLimitStore.entries()) {
      // Remove old timestamps
      entry.timestamps = entry.timestamps.filter(ts => ts > cutoff);
      
      // Remove entry if no timestamps left
      if (entry.timestamps.length === 0) {
        rateLimitStore.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  
  // Don't prevent Node from exiting
  cleanupInterval.unref();
}

// Start cleanup on module load
startCleanup();

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number; // milliseconds until window resets
}

/**
 * Check if a request is allowed under the rate limit (sliding window algorithm)
 * @param apiKeyId - The API key ID to check
 * @param limit - The rate limit (requests per minute), null = unlimited
 * @returns RateLimitResult with allowed status and metadata
 */
export function checkRateLimit(apiKeyId: string, limit: number | null): RateLimitResult {
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
  let entry = rateLimitStore.get(apiKeyId);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(apiKeyId, entry);
  }
  
  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter(ts => ts > windowStart);
  
  // Calculate remaining
  const count = entry.timestamps.length;
  const remaining = Math.max(0, limit - count);
  
  // Calculate reset time (when the oldest timestamp expires)
  const resetMs = entry.timestamps.length > 0 
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

/**
 * Reset rate limit for an API key (useful for testing)
 */
export function resetRateLimit(apiKeyId: string): void {
  rateLimitStore.delete(apiKeyId);
}

/**
 * Clear all rate limits (useful for testing)
 */
export function clearAllRateLimits(): void {
  rateLimitStore.clear();
}

/**
 * Stop the cleanup interval (for testing/shutdown)
 */
export function stopCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
