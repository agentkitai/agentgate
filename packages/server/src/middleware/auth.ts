// @agentgate/server - Authentication middleware

import type { Context, Next } from "hono";
import { validateApiKey } from "../lib/api-keys.js";
import { checkRateLimit, type RateLimitResult } from "../lib/rate-limiter.js";
import type { ApiKey } from "../db/index.js";

// Type for context variables
export type AuthVariables = {
  apiKey: ApiKey;
  rateLimit: RateLimitResult | null;
};

/**
 * Set rate limit headers on the response
 */
function setRateLimitHeaders(c: Context, result: RateLimitResult): void {
  if (result.limit > 0) {
    c.header("X-RateLimit-Limit", result.limit.toString());
    c.header("X-RateLimit-Remaining", result.remaining.toString());
    c.header("X-RateLimit-Reset", Math.ceil(Date.now() / 1000 + result.resetMs / 1000).toString());
  }
}

/**
 * Authentication middleware
 * Extracts Bearer token from Authorization header and validates against database
 * Also enforces rate limiting if configured on the API key
 */
export async function authMiddleware(
  c: Context,
  next: Next
): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");

  // Check for missing header
  if (!authHeader) {
    return c.json({ error: "Missing Authorization header" }, 401);
  }

  // Check for valid Bearer format
  if (!authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Invalid Authorization format" }, 401);
  }

  // Extract the key
  const key = authHeader.slice(7); // Remove "Bearer " prefix

  if (!key) {
    return c.json({ error: "Invalid Authorization format" }, 401);
  }

  // Validate the API key (also updates last_used_at)
  const apiKeyRecord = await validateApiKey(key);

  if (!apiKeyRecord) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  // Check rate limit
  const rateLimitResult = checkRateLimit(apiKeyRecord.id, apiKeyRecord.rateLimit);
  
  if (!rateLimitResult.allowed) {
    setRateLimitHeaders(c, rateLimitResult);
    c.header("Retry-After", Math.ceil(rateLimitResult.resetMs / 1000).toString());
    return c.json({ error: "Rate limit exceeded" }, 429);
  }

  // Attach API key record and rate limit info to context
  c.set("apiKey", apiKeyRecord);
  c.set("rateLimit", rateLimitResult);

  await next();
  
  // Set rate limit headers on successful responses
  if (rateLimitResult.limit > 0) {
    setRateLimitHeaders(c, rateLimitResult);
  }
}

/**
 * Scope-checking middleware factory
 * Returns middleware that checks if the authenticated API key has the required scope
 * @param scope - The required scope (e.g., "request:create", "admin")
 */
export function requireScope(scope: string) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const apiKey = c.get("apiKey") as ApiKey;
    const scopes = JSON.parse(apiKey.scopes) as string[];

    if (!scopes.includes(scope) && !scopes.includes("admin")) {
      return c.json({ error: `Missing required scope: ${scope}` }, 403);
    }

    await next();
  };
}
