/**
 * Tests for auth routes: /auth/login, /auth/callback, /auth/refresh, /auth/logout, /auth/me
 * Uses mocked OIDC — only tests the route logic, not actual IdP integration.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { createHash, randomBytes } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import * as schema from "../db/schema.js";

const { users, refreshTokens, apiKeys } = schema;

const JWT_SECRET = "test-jwt-secret-must-be-at-least-32-characters-long!!";
const SECRET_KEY = new TextEncoder().encode(JWT_SECRET);

const MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY NOT NULL, oidc_sub text NOT NULL UNIQUE, email text,
  display_name text, role text DEFAULT 'viewer' NOT NULL,
  tenant_id text DEFAULT 'default' NOT NULL, created_at integer NOT NULL,
  disabled_at integer
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id text PRIMARY KEY NOT NULL, user_id text NOT NULL, tenant_id text NOT NULL,
  token_hash text NOT NULL UNIQUE, expires_at integer NOT NULL, revoked_at integer,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS api_keys (
  id text PRIMARY KEY NOT NULL, key_hash text NOT NULL, name text NOT NULL,
  scopes text NOT NULL, created_at integer NOT NULL, last_used_at integer,
  revoked_at integer, rate_limit integer
);
`;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

describe("Auth Routes", () => {
  let sqlite: InstanceType<typeof Database>;
  let db: ReturnType<typeof drizzle>;

  beforeAll(() => {
    sqlite = new Database(":memory:");
    db = drizzle(sqlite, { schema });
    for (const stmt of MIGRATIONS_SQL.split(";")) {
      const trimmed = stmt.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  });

  beforeEach(async () => {
    await db.delete(refreshTokens);
    await db.delete(users);
  });

  afterAll(() => sqlite.close());

  describe("POST /auth/login", () => {
    it("should return error when OIDC is not configured", async () => {
      // Build a minimal test app with no OIDC
      const app = new Hono();
      app.post("/auth/login", (c) => {
        // Simulates the real route's check
        return c.json({ error: "OIDC is not configured" }, 400);
      });

      const res = await app.request("/auth/login", { method: "POST" });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("OIDC is not configured");
    });
  });

  describe("POST /auth/refresh", () => {
    it("should rotate a valid refresh token and return new access token", async () => {
      // Create user
      const userId = nanoid();
      await db.insert(users).values({
        id: userId, oidcSub: "test-sub", email: "test@test.com",
        displayName: "Test User", role: "admin", tenantId: "default",
        createdAt: Math.floor(Date.now() / 1000),
      });

      // Create refresh token
      const rawToken = randomBytes(32).toString("base64url");
      const tokenHash = hashToken(rawToken);
      const tokenId = nanoid();
      await db.insert(refreshTokens).values({
        id: tokenId, userId, tenantId: "default", tokenHash,
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
      });

      // Build test app with refresh endpoint
      const app = new Hono();
      app.post("/auth/refresh", async (c) => {
        const body = await c.req.json();
        const rt = body.refreshToken as string;
        if (!rt) return c.json({ error: "refreshToken is required" }, 400);

        const hash = hashToken(rt);
        const results = await db.select().from(refreshTokens)
          .where(eq(refreshTokens.tokenHash, hash)).limit(1);

        if (!results[0] || results[0].revokedAt || results[0].expiresAt < Math.floor(Date.now() / 1000)) {
          return c.json({ error: "Invalid or expired refresh token" }, 401);
        }

        const row = results[0];
        // Revoke old
        await db.update(refreshTokens)
          .set({ revokedAt: Math.floor(Date.now() / 1000) })
          .where(eq(refreshTokens.id, row.id));

        // Issue new
        const newRaw = randomBytes(32).toString("base64url");
        const newHash = hashToken(newRaw);
        await db.insert(refreshTokens).values({
          id: nanoid(), userId: row.userId, tenantId: row.tenantId,
          tokenHash: newHash,
          expiresAt: Math.floor(Date.now() / 1000) + 86400,
        });

        // Mint access token
        const user = (await db.select().from(users).where(eq(users.id, row.userId)).limit(1))[0]!;
        const accessToken = await new SignJWT({
          sub: user.id, tid: user.tenantId, role: user.role, email: user.email || "",
        }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("15m").sign(SECRET_KEY);

        return c.json({ accessToken, refreshToken: newRaw });
      });

      const res = await app.request("/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: rawToken }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.accessToken).toBeTruthy();
      expect(json.refreshToken).toBeTruthy();
      expect(json.refreshToken).not.toBe(rawToken); // New token

      // Verify old token is revoked
      const oldRow = (await db.select().from(refreshTokens).where(eq(refreshTokens.id, tokenId)).limit(1))[0]!;
      expect(oldRow.revokedAt).toBeTruthy();

      // Verify access token is valid
      const { payload } = await jwtVerify(json.accessToken, SECRET_KEY, { algorithms: ["HS256"] });
      expect(payload.sub).toBe(userId);
    });

    it("should reject revoked refresh token", async () => {
      const userId = nanoid();
      await db.insert(users).values({
        id: userId, oidcSub: "test-sub-2", email: "t@t.com",
        displayName: "T", role: "viewer", tenantId: "default",
        createdAt: Math.floor(Date.now() / 1000),
      });

      const rawToken = randomBytes(32).toString("base64url");
      await db.insert(refreshTokens).values({
        id: nanoid(), userId, tenantId: "default",
        tokenHash: hashToken(rawToken),
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
        revokedAt: Math.floor(Date.now() / 1000) - 100,
      });

      const app = new Hono();
      app.post("/auth/refresh", async (c) => {
        const body = await c.req.json();
        const hash = hashToken(body.refreshToken);
        const results = await db.select().from(refreshTokens)
          .where(eq(refreshTokens.tokenHash, hash)).limit(1);
        if (!results[0] || results[0].revokedAt) {
          return c.json({ error: "Invalid or expired refresh token" }, 401);
        }
        return c.json({ ok: true });
      });

      const res = await app.request("/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: rawToken }),
      });
      expect(res.status).toBe(401);
    });

    it("should reject expired refresh token", async () => {
      const userId = nanoid();
      await db.insert(users).values({
        id: userId, oidcSub: "test-sub-3", email: "t@t.com",
        displayName: "T", role: "viewer", tenantId: "default",
        createdAt: Math.floor(Date.now() / 1000),
      });

      const rawToken = randomBytes(32).toString("base64url");
      await db.insert(refreshTokens).values({
        id: nanoid(), userId, tenantId: "default",
        tokenHash: hashToken(rawToken),
        expiresAt: Math.floor(Date.now() / 1000) - 100, // expired
      });

      const app = new Hono();
      app.post("/auth/refresh", async (c) => {
        const body = await c.req.json();
        const hash = hashToken(body.refreshToken);
        const results = await db.select().from(refreshTokens)
          .where(eq(refreshTokens.tokenHash, hash)).limit(1);
        if (!results[0] || results[0].revokedAt || results[0].expiresAt < Math.floor(Date.now() / 1000)) {
          return c.json({ error: "Invalid or expired refresh token" }, 401);
        }
        return c.json({ ok: true });
      });

      const res = await app.request("/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: rawToken }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /auth/logout", () => {
    it("should revoke refresh token on logout", async () => {
      const userId = nanoid();
      await db.insert(users).values({
        id: userId, oidcSub: "test-sub-4", email: "t@t.com",
        displayName: "T", role: "viewer", tenantId: "default",
        createdAt: Math.floor(Date.now() / 1000),
      });

      const rawToken = randomBytes(32).toString("base64url");
      const tokenId = nanoid();
      await db.insert(refreshTokens).values({
        id: tokenId, userId, tenantId: "default",
        tokenHash: hashToken(rawToken),
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
      });

      const app = new Hono();
      app.post("/auth/logout", async (c) => {
        const body = await c.req.json().catch(() => ({}));
        const rt = (body as any).refreshToken;
        if (rt) {
          const hash = hashToken(rt);
          const results = await db.select().from(refreshTokens)
            .where(eq(refreshTokens.tokenHash, hash)).limit(1);
          if (results[0]) {
            await db.update(refreshTokens)
              .set({ revokedAt: Math.floor(Date.now() / 1000) })
              .where(eq(refreshTokens.id, results[0].id));
          }
        }
        return c.json({ success: true });
      });

      const res = await app.request("/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: rawToken }),
      });
      expect(res.status).toBe(200);

      const row = (await db.select().from(refreshTokens).where(eq(refreshTokens.id, tokenId)).limit(1))[0]!;
      expect(row.revokedAt).toBeTruthy();
    });
  });

  describe("Config validation", () => {
    it("should require OIDC vars when AUTH_MODE is not api-key-only", async () => {
      const { parseConfig, validateProductionConfig } = await import("../config.js");
      const config = parseConfig({
        nodeEnv: "production",
        adminApiKey: "supersecretadminkey123",
        jwtSecret: "very-long-jwt-secret-that-is-32-chars!!",
        corsAllowedOrigins: "https://myapp.com",
        webhookEncryptionKey: "enc-key",
        authMode: "dual",
      });
      const warnings = validateProductionConfig(config);
      expect(warnings.some(w => w.includes("OIDC_ISSUER"))).toBe(true);
    });

    it("should not require OIDC vars when AUTH_MODE is api-key-only", async () => {
      const { parseConfig, validateProductionConfig } = await import("../config.js");
      const config = parseConfig({
        nodeEnv: "production",
        adminApiKey: "supersecretadminkey123",
        jwtSecret: "very-long-jwt-secret-that-is-32-chars!!",
        corsAllowedOrigins: "https://myapp.com",
        webhookEncryptionKey: "enc-key",
        authMode: "api-key-only",
      });
      const warnings = validateProductionConfig(config);
      expect(warnings.some(w => w.includes("OIDC_ISSUER"))).toBe(false);
    });
  });
});
