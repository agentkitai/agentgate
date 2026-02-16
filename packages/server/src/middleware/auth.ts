// @agentgate/server - Authentication & authorization middleware
//
// Dual-mode auth: API key (agk_*) and OIDC JWT.
// Uses @agentkit/auth middleware factory for JWT handling.

import type { Context, Next } from "hono";
import { createHash } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { getDb, apiKeys, users, type ApiKey } from "../db/index.js";
import { getRateLimiter, type RateLimitResult } from "../lib/rate-limiter/index.js";
import { getConfig } from "../config.js";
import {
  verifyAccessToken,
  type AuthConfig,
  type Role,
} from "@agentkit/auth";
import {
  type AgentGatePermission,
  mapScopesToPermissions,
  roleToPermissions,
  hasAgentGatePermission,
} from "../lib/rbac.js";

// ── Types ──────────────────────────────────────────────────────────

export interface AgentGateAuthContext {
  identity: {
    type: 'user' | 'api_key';
    id: string;
    displayName: string;
    email?: string;
    role: Role;
  };
  tenantId: string;
  permissions: AgentGatePermission[];
}

export type AuthVariables = {
  apiKey: ApiKey;
  auth: AgentGateAuthContext;
  rateLimit: RateLimitResult | null;
};

// ── Helpers ────────────────────────────────────────────────────────

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function getAuthConfig(): AuthConfig {
  const config = getConfig();
  return {
    oidc: config.oidcIssuer
      ? {
          issuerUrl: config.oidcIssuer,
          clientId: config.oidcClientId || '',
          clientSecret: config.oidcClientSecret || '',
          redirectUri: config.oidcRedirectUri || '',
          scopes: ['openid', 'profile', 'email'],
        }
      : null,
    jwt: {
      secret: config.jwtSecret || 'dev-secret-not-for-production',
      accessTokenTtlSeconds: config.jwtAccessTtl,
      refreshTokenTtlSeconds: config.jwtRefreshTtl,
    },
    authDisabled: false,
  };
}

function setRateLimitHeaders(c: Context, result: RateLimitResult): void {
  if (result.limit > 0) {
    c.header("X-RateLimit-Limit", result.limit.toString());
    c.header("X-RateLimit-Remaining", result.remaining.toString());
    c.header("X-RateLimit-Reset", Math.ceil(Date.now() / 1000 + result.resetMs / 1000).toString());
  }
}

/** Minimal cookie parser */
function getCookie(c: Context, name: string): string | undefined {
  const header = c.req.header('Cookie');
  if (!header) return undefined;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1];
}

// ── API Key Resolution ─────────────────────────────────────────────

async function resolveApiKeyAuth(key: string): Promise<AgentGateAuthContext | null> {
  const hash = hashApiKey(key);
  const results = await getDb()
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (!results[0]) return null;
  const apiKey = results[0];
  const scopes = JSON.parse(apiKey.scopes) as string[];
  const role: Role = scopes.includes('admin') ? 'admin' : 'editor';

  return {
    identity: {
      type: 'api_key',
      id: apiKey.id,
      displayName: apiKey.name,
      role,
    },
    tenantId: 'default',
    permissions: mapScopesToPermissions(scopes),
  };
}

// ── JWT Resolution ─────────────────────────────────────────────────

async function resolveJwtAuth(token: string): Promise<AgentGateAuthContext | null> {
  const authConfig = getAuthConfig();
  const claims = await verifyAccessToken(token, authConfig);
  if (!claims) return null;

  // Look up user in DB
  const userResults = await getDb()
    .select()
    .from(users)
    .where(eq(users.oidcSub, claims.sub))
    .limit(1);

  if (!userResults[0]) return null;
  const user = userResults[0];

  if (user.disabledAt) return null;

  const role = (user.role as Role) || 'viewer';

  return {
    identity: {
      type: 'user',
      id: user.id,
      displayName: user.displayName || user.email || claims.sub,
      email: user.email || claims.email,
      role,
    },
    tenantId: user.tenantId || 'default',
    permissions: roleToPermissions(role),
  };
}

// ── Main Auth Middleware ────────────────────────────────────────────

/**
 * Authentication middleware
 * Supports dual-mode: API key (agk_*) and JWT tokens.
 * AUTH_MODE controls which paths are allowed.
 */
export async function authMiddleware(
  c: Context,
  next: Next
): Promise<Response | void> {
  const config = getConfig();
  const authMode = config.authMode;

  // Extract token
  const authHeader = c.req.header("Authorization");
  let token: string | undefined;

  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  }

  const sessionCookie = getCookie(c, 'session');

  // ── API key flow ───────────────────────────────────────────
  if (token?.startsWith('agk_')) {
    if (authMode === 'oidc-required') {
      return c.json({ error: "API key authentication is not allowed in oidc-required mode" }, 401);
    }

    const authCtx = await resolveApiKeyAuth(token);
    if (!authCtx) {
      return c.json({ error: "Invalid API key" }, 401);
    }

    // Rate limiting (only for API keys, not JWT users)
    const hash = hashApiKey(token);
    const apiKeyResults = await getDb()
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
      .limit(1);

    const apiKeyRecord = apiKeyResults[0];
    if (apiKeyRecord) {
      const rateLimiter = getRateLimiter();
      const rateLimitResult = await rateLimiter.checkLimit(apiKeyRecord.id, apiKeyRecord.rateLimit);

      if (!rateLimitResult.allowed) {
        setRateLimitHeaders(c, rateLimitResult);
        c.header("Retry-After", Math.ceil(rateLimitResult.resetMs / 1000).toString());
        return c.json({ error: "Rate limit exceeded" }, 429);
      }

      c.set("apiKey", apiKeyRecord);
      c.set("rateLimit", rateLimitResult);

      // Set auth context
      c.set("auth", authCtx);
      await next();

      if (rateLimitResult.limit > 0) {
        setRateLimitHeaders(c, rateLimitResult);
      }
      return;
    }

    return c.json({ error: "Invalid API key" }, 401);
  }

  // ── JWT flow ───────────────────────────────────────────────
  const jwtToken = token ?? sessionCookie;

  if (jwtToken) {
    if (authMode === 'api-key-only') {
      return c.json({ error: "JWT authentication is not allowed in api-key-only mode" }, 401);
    }

    const authCtx = await resolveJwtAuth(jwtToken);
    if (!authCtx) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }

    c.set("auth", authCtx);
    c.set("rateLimit", null);
    await next();
    return;
  }

  // ── No credentials ─────────────────────────────────────────
  if (!authHeader) {
    return c.json({ error: "Missing Authorization header" }, 401);
  }

  if (!authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Invalid Authorization format" }, 401);
  }

  return c.json({ error: "Invalid API key" }, 401);
}

/**
 * Permission-checking middleware factory (replaces requireScope)
 * Returns middleware that checks if the authenticated identity has the required permission.
 */
export function requirePermission(permission: AgentGatePermission) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const auth = c.get("auth") as AgentGateAuthContext | undefined;

    if (!auth) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (!hasAgentGatePermission(auth.permissions, permission)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    await next();
  };
}

/**
 * Scope-checking middleware factory (DEPRECATED — use requirePermission)
 * Kept for backward compatibility during migration.
 */
export function requireScope(scope: string) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    // Try permission-based check first (new path)
    const auth = c.get("auth") as AgentGateAuthContext | undefined;
    if (auth) {
      // 'admin' scope maps to '*' permission
      const permission: AgentGatePermission = scope === 'admin' ? '*' : scope as AgentGatePermission;
      if (!hasAgentGatePermission(auth.permissions, permission)) {
        return c.json({ error: `Missing required scope: ${scope}` }, 403);
      }
      return next();
    }

    // Fallback: check apiKey directly (legacy path)
    const apiKey = c.get("apiKey") as ApiKey | undefined;
    if (!apiKey) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const scopes = JSON.parse(apiKey.scopes) as string[];
    if (!scopes.includes(scope) && !scopes.includes("admin")) {
      return c.json({ error: `Missing required scope: ${scope}` }, 403);
    }

    await next();
  };
}
