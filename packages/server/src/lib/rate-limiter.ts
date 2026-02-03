// @agentgate/server - Rate limiter (legacy re-exports)
// This file is kept for backwards compatibility
// New code should import from ./rate-limiter/index.js

export {
  type RateLimiter,
  type RateLimitResult,
  type RateLimiterBackend,
  InMemoryRateLimiter,
  RedisRateLimiter,
  createRateLimiter,
  getRateLimiter,
  setRateLimiter,
  resetRateLimiter,
  checkRateLimit,
  resetRateLimit,
  clearAllRateLimits,
  stopCleanup,
} from "./rate-limiter/index.js";
