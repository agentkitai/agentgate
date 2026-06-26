// @agentkitai/agentgate-server - Security headers middleware

import type { Context, Next } from "hono";
import { getConfig } from "../config.js";

/**
 * Security headers middleware
 * Adds standard security headers to all responses
 */
export async function securityHeadersMiddleware(
  c: Context,
  next: Next
): Promise<void> {
  await next();

  // Prevent MIME type sniffing
  c.header("X-Content-Type-Options", "nosniff");

  // Prevent clickjacking
  c.header("X-Frame-Options", "DENY");

  // Enable XSS filter (legacy browsers)
  c.header("X-XSS-Protection", "1; mode=block");

  // Control referrer information
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");

  // HSTS — enabled by explicit config, or automatically in production
  const config = getConfig();
  if (config.hstsEnabled || config.nodeEnv === "production") {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  // Content Security Policy - allows inline styles for HTML responses
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
  );
}
