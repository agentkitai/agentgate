// @agentgate/server — OIDC auth routes
//
// GET  /auth/mode      → Return current AUTH_MODE for dashboard detection
// POST /auth/login     → Initiate OIDC login (returns redirect URL)
// GET  /auth/callback  → Handle IdP callback, exchange code, mint JWT
// POST /auth/refresh   → Rotate refresh token, get new access token
// POST /auth/logout    → Revoke refresh token
// GET  /auth/me        → Return current user info from JWT

import { Hono } from "hono";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { getDb, users, refreshTokens } from "../db/index.js";
import { getConfig } from "../config.js";
import {
  OidcClient,
  signAccessToken,
  hashToken,
  type AuthConfig,
  type Role,
} from "agentkit-auth";
import { getLogger } from "../lib/logger.js";
import type { AgentGateAuthContext } from "../middleware/auth.js";
import { randomBytes } from "node:crypto";

import type { AuthVariables } from "../middleware/auth.js";

const authRouter = new Hono<{ Variables: AuthVariables }>();

// ── In-memory PKCE store (per-session) ────────────────────────────
// In production, use Redis or DB. This is sufficient for single-instance.
const pkceStore = new Map<string, { codeVerifier: string; createdAt: number }>();

// Clean up old PKCE entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000; // 10 min TTL
  for (const [key, val] of pkceStore.entries()) {
    if (val.createdAt < cutoff) pkceStore.delete(key);
  }
}, 5 * 60 * 1000);

// ── Helpers ────────────────────────────────────────────────────────

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

function getOidcClient(): OidcClient | null {
  const authConfig = getAuthConfig();
  if (!authConfig.oidc) return null;
  return new OidcClient({
    issuerUrl: authConfig.oidc.issuerUrl,
    clientId: authConfig.oidc.clientId,
    clientSecret: authConfig.oidc.clientSecret,
    redirectUri: authConfig.oidc.redirectUri,
    tenantClaim: getConfig().oidcTenantClaim,
    roleClaim: getConfig().oidcRoleClaim,
  });
}

/** Create or update a user from OIDC claims */
async function upsertUser(claims: {
  sub: string;
  email?: string;
  name?: string;
  tenantId?: string;
  role?: string;
}): Promise<{ id: string; role: Role; tenantId: string; displayName: string; email: string | null }> {
  const db = getDb();
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.oidcSub, claims.sub))
    .limit(1);

  if (existing[0]) {
    const user = existing[0];
    return {
      id: user.id,
      role: (user.role as Role) || 'viewer',
      tenantId: user.tenantId,
      displayName: user.displayName || user.email || claims.sub,
      email: user.email,
    };
  }

  // Create new user
  const id = nanoid();
  const role = (claims.role as Role) || 'viewer';
  const tenantId = claims.tenantId || 'default';

  await db.insert(users).values({
    id,
    oidcSub: claims.sub,
    email: claims.email || null,
    displayName: claims.name || claims.email || null,
    role,
    tenantId,
    createdAt: Math.floor(Date.now() / 1000),
  });

  return {
    id,
    role,
    tenantId,
    displayName: claims.name || claims.email || claims.sub,
    email: claims.email || null,
  };
}

/** Store a refresh token */
async function storeRefreshToken(userId: string, tenantId: string): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  const hash = hashToken(raw);
  const config = getConfig();
  const ttl = config.jwtRefreshTtl;
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  const id = nanoid();

  await getDb().insert(refreshTokens).values({
    id,
    userId,
    tenantId,
    tokenHash: hash,
    expiresAt,
  });

  return raw;
}

/** Validate and consume a refresh token (rotate) */
async function rotateRefreshTokenInDb(rawToken: string): Promise<{
  userId: string;
  tenantId: string;
  newToken: string;
} | null> {
  const hash = hashToken(rawToken);
  const db = getDb();

  const results = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hash))
    .limit(1);

  if (!results[0]) return null;
  const row = results[0];

  // Check if revoked or expired
  if (row.revokedAt) return null;
  if (row.expiresAt < Math.floor(Date.now() / 1000)) return null;

  // Revoke old token
  await db
    .update(refreshTokens)
    .set({ revokedAt: Math.floor(Date.now() / 1000) })
    .where(eq(refreshTokens.id, row.id));

  // Issue new one
  const newToken = await storeRefreshToken(row.userId, row.tenantId);

  return {
    userId: row.userId,
    tenantId: row.tenantId,
    newToken,
  };
}

// ── Routes ─────────────────────────────────────────────────────────

/**
 * GET /auth/mode
 * Returns the current auth mode so the dashboard can show SSO vs API key login.
 * Public endpoint — no auth required.
 */
authRouter.get("/mode", async (c) => {
  const config = getConfig();
  return c.json({ mode: config.authMode || 'api-key-only' });
});

/**
 * POST /auth/login
 * Initiates OIDC login — returns the authorization URL for the client to redirect to.
 */
authRouter.post("/login", async (c) => {
  const oidcClient = getOidcClient();
  if (!oidcClient) {
    return c.json({ error: "OIDC is not configured" }, 400);
  }

  try {
    const state = OidcClient.generateState();
    const codeVerifier = OidcClient.generateCodeVerifier();

    pkceStore.set(state, { codeVerifier, createdAt: Date.now() });

    const authUrl = await oidcClient.getAuthorizationUrl(state, codeVerifier);

    return c.json({ url: authUrl, state });
  } catch (err) {
    getLogger().error({ err }, "Failed to initiate OIDC login");
    return c.json({ error: "Failed to initiate login" }, 500);
  }
});

/**
 * GET /auth/callback
 * Handles the IdP callback. Exchanges code for tokens, creates/updates user, mints session.
 */
authRouter.get("/callback", async (c) => {
  const oidcClient = getOidcClient();
  if (!oidcClient) {
    return c.json({ error: "OIDC is not configured" }, 400);
  }

  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    return c.json({ error: `IdP error: ${error}` }, 400);
  }

  if (!code || !state) {
    return c.json({ error: "Missing code or state parameter" }, 400);
  }

  const pkceEntry = pkceStore.get(state);
  if (!pkceEntry) {
    return c.json({ error: "Invalid or expired state parameter" }, 400);
  }
  pkceStore.delete(state);

  try {
    const tokenSet = await oidcClient.exchangeCode(code, pkceEntry.codeVerifier);
    const user = await upsertUser(tokenSet.claims);

    // Mint access token
    const authConfig = getAuthConfig();
    const accessToken = await signAccessToken(
      {
        sub: user.id,
        tid: user.tenantId,
        role: user.role,
        email: user.email || '',
      },
      authConfig,
    );

    // Create refresh token
    const refreshToken = await storeRefreshToken(user.id, user.tenantId);

    // Set session cookie (httpOnly, Secure in production, SameSite=Strict)
    const isProduction = getConfig().nodeEnv === 'production';
    c.header(
      'Set-Cookie',
      `session=${accessToken}; HttpOnly; ${isProduction ? 'Secure; ' : ''}SameSite=Strict; Path=/; Max-Age=${authConfig.jwt.accessTokenTtlSeconds}`,
    );

    // Check Accept header — if the client wants JSON (API call), return JSON.
    // Otherwise (browser redirect from IdP), redirect to dashboard.
    const accept = c.req.header('Accept') || '';
    if (accept.includes('application/json')) {
      return c.json({
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          displayName: user.displayName,
          email: user.email,
          role: user.role,
          tenantId: user.tenantId,
        },
      });
    }

    // Browser redirect — store refresh token in a short-lived cookie for the dashboard to pick up
    c.header(
      'Set-Cookie',
      `agentgate_refresh=${refreshToken}; ${isProduction ? 'Secure; ' : ''}SameSite=Strict; Path=/; Max-Age=60`,
    );

    // Redirect to dashboard root
    const dashboardUrl = getConfig().dashboardUrl || '/';
    return c.redirect(dashboardUrl);
  } catch (err) {
    getLogger().error({ err }, "OIDC callback failed");
    // Redirect to login with error on browser callbacks
    const accept = c.req.header('Accept') || '';
    if (accept.includes('application/json')) {
      return c.json({ error: "Authentication failed" }, 401);
    }
    const dashboardUrl = getConfig().dashboardUrl || '/';
    return c.redirect(`${dashboardUrl}/login?error=authentication_failed`);
  }
});

/**
 * POST /auth/refresh
 * Rotates refresh token and issues new access token.
 */
authRouter.post("/refresh", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Request body required" }, 400);
  }

  const refreshToken = body.refreshToken as string;
  if (!refreshToken) {
    return c.json({ error: "refreshToken is required" }, 400);
  }

  const result = await rotateRefreshTokenInDb(refreshToken);
  if (!result) {
    return c.json({ error: "Invalid or expired refresh token" }, 401);
  }

  // Look up user
  const userResults = await getDb()
    .select()
    .from(users)
    .where(eq(users.id, result.userId))
    .limit(1);

  if (!userResults[0] || userResults[0].disabledAt) {
    return c.json({ error: "User not found or disabled" }, 401);
  }

  const user = userResults[0];
  const role = (user.role as Role) || 'viewer';

  const authConfig = getAuthConfig();
  const accessToken = await signAccessToken(
    {
      sub: user.id,
      tid: user.tenantId,
      role,
      email: user.email || '',
    },
    authConfig,
  );

  // Update session cookie
  const isProduction = getConfig().nodeEnv === 'production';
  c.header(
    'Set-Cookie',
    `session=${accessToken}; HttpOnly; ${isProduction ? 'Secure; ' : ''}SameSite=Strict; Path=/; Max-Age=${authConfig.jwt.accessTokenTtlSeconds}`,
  );

  return c.json({
    accessToken,
    refreshToken: result.newToken,
  });
});

/**
 * POST /auth/logout
 * Revokes the refresh token and clears the session cookie.
 */
authRouter.post("/logout", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const refreshToken = body.refreshToken as string;
  if (refreshToken) {
    const hash = hashToken(refreshToken);
    const results = await getDb()
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hash))
      .limit(1);

    if (results[0]) {
      await getDb()
        .update(refreshTokens)
        .set({ revokedAt: Math.floor(Date.now() / 1000) })
        .where(eq(refreshTokens.id, results[0].id));
    }
  }

  // Clear session cookie
  c.header('Set-Cookie', 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');

  return c.json({ success: true });
});

/**
 * GET /auth/me
 * Returns current user info from the JWT or API key auth context.
 * Requires authentication — applies authMiddleware inline.
 */
import { authMiddleware } from "../middleware/auth.js";

authRouter.get("/me", authMiddleware, async (c) => {
  const auth = c.get("auth") as AgentGateAuthContext | undefined;

  if (!auth) {
    return c.json({ error: "Authentication required" }, 401);
  }

  return c.json({
    id: auth.identity.id,
    displayName: auth.identity.displayName,
    email: auth.identity.email,
    role: auth.identity.role,
    type: auth.identity.type,
    tenantId: auth.tenantId,
    permissions: auth.permissions,
  });
});

export default authRouter;
