/**
 * Integration tests for OIDC auth, dual-mode auth, and RBAC.
 * Tests the authMiddleware with JWT tokens and API keys in different AUTH_MODE settings.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { createHash, randomBytes } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { SignJWT } from "jose";
import * as schema from "../../db/schema.js";
import type { AgentGateAuthContext, AuthVariables } from "../../middleware/auth.js";
import { type AgentGatePermission, hasAgentGatePermission, mapScopesToPermissions, roleToPermissions } from "../../lib/rbac.js";

const { apiKeys, users, refreshTokens } = schema;

// ── Test Setup ─────────────────────────────────────────────────────

const JWT_SECRET = "test-jwt-secret-must-be-at-least-32-characters-long!!";

const MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS approval_requests (
  id text PRIMARY KEY NOT NULL, action text NOT NULL, params text, context text,
  status text NOT NULL, urgency text NOT NULL, created_at integer NOT NULL,
  updated_at integer NOT NULL, decided_at integer, decided_by text,
  decision_reason text, expires_at integer
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY NOT NULL, request_id text NOT NULL, event_type text NOT NULL,
  actor text NOT NULL, details text, created_at integer NOT NULL,
  FOREIGN KEY (request_id) REFERENCES approval_requests(id)
);
CREATE TABLE IF NOT EXISTS policies (
  id text PRIMARY KEY NOT NULL, name text NOT NULL, rules text NOT NULL,
  priority integer NOT NULL, enabled integer NOT NULL, created_at integer NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  id text PRIMARY KEY NOT NULL, key_hash text NOT NULL, name text NOT NULL,
  scopes text NOT NULL, created_at integer NOT NULL, last_used_at integer,
  revoked_at integer, rate_limit integer
);
CREATE TABLE IF NOT EXISTS webhooks (
  id text PRIMARY KEY NOT NULL, url text NOT NULL, secret text NOT NULL,
  events text NOT NULL, created_at integer NOT NULL, enabled integer DEFAULT 1 NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id text PRIMARY KEY NOT NULL, webhook_id text NOT NULL, event text NOT NULL,
  payload text NOT NULL, status text NOT NULL, attempts integer DEFAULT 0 NOT NULL,
  last_attempt_at integer, response_code integer, response_body text,
  FOREIGN KEY (webhook_id) REFERENCES webhooks(id)
);
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
`;

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

async function createApiKeyInDb(
  db: ReturnType<typeof drizzle>,
  name: string,
  scopes: string[],
): Promise<{ id: string; key: string }> {
  const id = nanoid();
  const randomPart = randomBytes(32).toString("base64url");
  const key = `agk_${randomPart}`;
  const keyHash = hashApiKey(key);
  await db.insert(apiKeys).values({
    id, keyHash, name, scopes: JSON.stringify(scopes),
    createdAt: Math.floor(Date.now() / 1000),
  });
  return { id, key };
}

async function createUserInDb(
  db: ReturnType<typeof drizzle>,
  opts: { sub: string; email?: string; role?: string; tenantId?: string; disabled?: boolean },
): Promise<string> {
  const id = nanoid();
  await db.insert(users).values({
    id,
    oidcSub: opts.sub,
    email: opts.email || `${opts.sub}@test.com`,
    displayName: opts.email || opts.sub,
    role: opts.role || "viewer",
    tenantId: opts.tenantId || "default",
    createdAt: Math.floor(Date.now() / 1000),
    disabledAt: opts.disabled ? Math.floor(Date.now() / 1000) : null,
  });
  return id;
}

async function mintJwt(sub: string, opts: { role?: string; tid?: string; email?: string } = {}): Promise<string> {
  return new SignJWT({
    sub,
    tid: opts.tid || "default",
    role: opts.role || "viewer",
    email: opts.email || `${sub}@test.com`,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function mintExpiredJwt(sub: string): Promise<string> {
  return new SignJWT({ sub, tid: "default", role: "viewer", email: "test@test.com" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
    .sign(new TextEncoder().encode(JWT_SECRET));
}

// ── Build Test App ─────────────────────────────────────────────────

function buildTestApp(db: ReturnType<typeof drizzle>, authMode: string = "dual") {
  const app = new Hono<{ Variables: AuthVariables }>();

  // Inline auth middleware that mimics the real one but uses the test DB
  app.use("/api/*", async (c, next) => {
    const authHeader = c.req.header("Authorization");
    let token: string | undefined;
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    }

    // Cookie
    const cookieHeader = c.req.header("Cookie");
    let sessionCookie: string | undefined;
    if (cookieHeader) {
      const match = cookieHeader.match(/(?:^|;\s*)session=([^;]*)/);
      sessionCookie = match?.[1];
    }

    // API key flow
    if (token?.startsWith("agk_")) {
      if (authMode === "oidc-required") {
        return c.json({ error: "API key authentication is not allowed in oidc-required mode" }, 401);
      }
      const hash = hashApiKey(token);
      const results = await db.select().from(apiKeys)
        .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
        .limit(1);
      if (!results[0]) return c.json({ error: "Invalid API key" }, 401);
      const apiKey = results[0];
      const scopes = JSON.parse(apiKey.scopes) as string[];
      const role = scopes.includes("admin") ? "admin" : "editor";
      const auth: AgentGateAuthContext = {
        identity: { type: "api_key", id: apiKey.id, displayName: apiKey.name, role: role as any },
        tenantId: "default",
        permissions: mapScopesToPermissions(scopes),
      };
      c.set("apiKey", apiKey as any);
      c.set("auth", auth);
      c.set("rateLimit", null);
      return next();
    }

    // JWT flow
    const jwtToken = token ?? sessionCookie;
    if (jwtToken) {
      if (authMode === "api-key-only") {
        return c.json({ error: "JWT authentication is not allowed in api-key-only mode" }, 401);
      }
      try {
        const { jwtVerify } = await import("jose");
        const { payload } = await jwtVerify(jwtToken, new TextEncoder().encode(JWT_SECRET), { algorithms: ["HS256"] });
        const sub = payload.sub as string;
        const userResults = await db.select().from(users).where(eq(users.oidcSub, sub)).limit(1);
        // Also check by user id
        let user = userResults[0];
        if (!user) {
          const byId = await db.select().from(users).where(eq(users.id, sub)).limit(1);
          user = byId[0];
        }
        if (!user || user.disabledAt) return c.json({ error: "Invalid or expired token" }, 401);
        const role = (user.role as any) || "viewer";
        const auth: AgentGateAuthContext = {
          identity: { type: "user", id: user.id, displayName: user.displayName || "", email: user.email || undefined, role },
          tenantId: user.tenantId || "default",
          permissions: roleToPermissions(role),
        };
        c.set("auth", auth);
        c.set("rateLimit", null);
        return next();
      } catch {
        return c.json({ error: "Invalid or expired token" }, 401);
      }
    }

    if (!authHeader) return c.json({ error: "Missing Authorization header" }, 401);
    return c.json({ error: "Invalid Authorization format" }, 401);
  });

  // Permission middleware helper
  function requirePermission(permission: AgentGatePermission) {
    return async (c: any, next: any) => {
      const auth = c.get("auth") as AgentGateAuthContext | undefined;
      if (!auth) return c.json({ error: "Unauthorized" }, 401);
      if (!hasAgentGatePermission(auth.permissions, permission)) {
        return c.json({ error: "Forbidden" }, 403);
      }
      return next();
    };
  }

  // Test routes
  app.get("/api/requests", (c) => c.json({ ok: true }));
  app.post("/api/requests/:id/decide", requirePermission("approvals:decide"), (c) => c.json({ ok: true }));
  app.get("/api/policies", requirePermission("policies:read"), (c) => c.json({ ok: true }));
  app.post("/api/policies", requirePermission("policies:write"), (c) => c.json({ ok: true }));
  app.get("/api/api-keys", requirePermission("keys:manage"), (c) => c.json({ ok: true }));

  return app;
}

// ── Tests ──────────────────────────────────────────────────────────

describe("OIDC Auth Integration", () => {
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
    // Don't delete api_keys between tests — they're needed
  });

  afterAll(() => sqlite.close());

  describe("API key backward compatibility", () => {
    it("should authenticate with valid API key in dual mode", async () => {
      const app = buildTestApp(db, "dual");
      const { key } = await createApiKeyInDb(db, "test-key", ["admin"]);
      const res = await app.request("/api/requests", {
        headers: { Authorization: `Bearer ${key}` },
      });
      expect(res.status).toBe(200);
    });

    it("should authenticate with valid API key in api-key-only mode", async () => {
      const app = buildTestApp(db, "api-key-only");
      const { key } = await createApiKeyInDb(db, "test-key-2", ["admin"]);
      const res = await app.request("/api/requests", {
        headers: { Authorization: `Bearer ${key}` },
      });
      expect(res.status).toBe(200);
    });

    it("should reject API key in oidc-required mode", async () => {
      const app = buildTestApp(db, "oidc-required");
      const { key } = await createApiKeyInDb(db, "test-key-3", ["admin"]);
      const res = await app.request("/api/requests", {
        headers: { Authorization: `Bearer ${key}` },
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toContain("oidc-required");
    });

    it("should reject invalid API key", async () => {
      const app = buildTestApp(db, "dual");
      const res = await app.request("/api/requests", {
        headers: { Authorization: "Bearer agk_invalidkey" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("JWT authentication", () => {
    it("should authenticate with valid JWT in dual mode", async () => {
      const app = buildTestApp(db, "dual");
      const userId = await createUserInDb(db, { sub: "user-1", role: "admin" });
      const jwt = await mintJwt(userId);
      const res = await app.request("/api/requests", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(res.status).toBe(200);
    });

    it("should reject JWT in api-key-only mode", async () => {
      const app = buildTestApp(db, "api-key-only");
      const userId = await createUserInDb(db, { sub: "user-2" });
      const jwt = await mintJwt(userId);
      const res = await app.request("/api/requests", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toContain("api-key-only");
    });

    it("should reject expired JWT", async () => {
      const app = buildTestApp(db, "dual");
      await createUserInDb(db, { sub: "user-3" });
      const jwt = await mintExpiredJwt("user-3");
      const res = await app.request("/api/requests", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(res.status).toBe(401);
    });

    it("should reject JWT with invalid signature", async () => {
      const app = buildTestApp(db, "dual");
      await createUserInDb(db, { sub: "user-4" });
      const jwt = await new SignJWT({ sub: "user-4", tid: "default", role: "viewer", email: "test@test.com" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("15m")
        .sign(new TextEncoder().encode("wrong-secret-wrong-secret-wrong-secret!!"));
      const res = await app.request("/api/requests", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(res.status).toBe(401);
    });

    it("should reject JWT for disabled user", async () => {
      const app = buildTestApp(db, "dual");
      const userId = await createUserInDb(db, { sub: "user-5", disabled: true });
      const jwt = await mintJwt(userId);
      const res = await app.request("/api/requests", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(res.status).toBe(401);
    });

    it("should authenticate via session cookie", async () => {
      const app = buildTestApp(db, "dual");
      const userId = await createUserInDb(db, { sub: "user-6", role: "admin" });
      const jwt = await mintJwt(userId);
      const res = await app.request("/api/requests", {
        headers: { Cookie: `session=${jwt}` },
      });
      expect(res.status).toBe(200);
    });
  });

  describe("RBAC — permission-based access control", () => {
    it("viewer cannot decide approvals (403)", async () => {
      const app = buildTestApp(db, "dual");
      const userId = await createUserInDb(db, { sub: "viewer-1", role: "viewer" });
      const jwt = await mintJwt(userId);
      const res = await app.request("/api/requests/test-id/decide", {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(403);
    });

    it("viewer can read policies (200)", async () => {
      const app = buildTestApp(db, "dual");
      const userId = await createUserInDb(db, { sub: "viewer-2", role: "viewer" });
      const jwt = await mintJwt(userId);
      const res = await app.request("/api/policies", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(res.status).toBe(200);
    });

    it("editor can decide approvals (200)", async () => {
      const app = buildTestApp(db, "dual");
      const userId = await createUserInDb(db, { sub: "editor-1", role: "editor" });
      const jwt = await mintJwt(userId);
      const res = await app.request("/api/requests/test-id/decide", {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
    });

    it("editor cannot manage policies (403)", async () => {
      const app = buildTestApp(db, "dual");
      const userId = await createUserInDb(db, { sub: "editor-2", role: "editor" });
      const jwt = await mintJwt(userId);
      const res = await app.request("/api/policies", {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(403);
    });

    it("editor cannot manage API keys (403)", async () => {
      const app = buildTestApp(db, "dual");
      const userId = await createUserInDb(db, { sub: "editor-3", role: "editor" });
      const jwt = await mintJwt(userId);
      const res = await app.request("/api/api-keys", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(res.status).toBe(403);
    });

    it("admin can do everything", async () => {
      const app = buildTestApp(db, "dual");
      const userId = await createUserInDb(db, { sub: "admin-1", role: "admin" });
      const jwt = await mintJwt(userId);

      const r1 = await app.request("/api/requests", { headers: { Authorization: `Bearer ${jwt}` } });
      expect(r1.status).toBe(200);

      const r2 = await app.request("/api/policies", { headers: { Authorization: `Bearer ${jwt}` } });
      expect(r2.status).toBe(200);

      const r3 = await app.request("/api/api-keys", { headers: { Authorization: `Bearer ${jwt}` } });
      expect(r3.status).toBe(200);
    });

    it("existing API keys with admin scope still have full access", async () => {
      const app = buildTestApp(db, "dual");
      const { key } = await createApiKeyInDb(db, "legacy-admin", ["admin"]);
      const res = await app.request("/api/api-keys", {
        headers: { Authorization: `Bearer ${key}` },
      });
      expect(res.status).toBe(200);
    });

    it("existing API keys with old scopes still work", async () => {
      const app = buildTestApp(db, "dual");
      const { key } = await createApiKeyInDb(db, "legacy-read", ["request:read"]);
      const res = await app.request("/api/requests", {
        headers: { Authorization: `Bearer ${key}` },
      });
      expect(res.status).toBe(200);
    });
  });

  describe("Auth mode enforcement", () => {
    it("no credentials returns 401", async () => {
      const app = buildTestApp(db, "dual");
      const res = await app.request("/api/requests");
      expect(res.status).toBe(401);
    });

    it("non-Bearer format returns 401", async () => {
      const app = buildTestApp(db, "dual");
      const res = await app.request("/api/requests", {
        headers: { Authorization: "Basic abc123" },
      });
      expect(res.status).toBe(401);
    });
  });
});
