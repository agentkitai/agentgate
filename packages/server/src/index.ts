import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import requestsRouter from "./routes/requests.js";
import policiesRouter from "./routes/policies.js";
import apiKeysRouter from "./routes/api-keys.js";
import webhooksRouter from "./routes/webhooks.js";
import auditRouter from "./routes/audit.js";
import tokensRouter from "./routes/tokens.js";
import decideRouter from "./routes/decide.js";
import overridesRouter from "./routes/overrides.js";
import { startOverrideCleanup, stopOverrideCleanup } from "./routes/overrides.js";
import probesRouter from "./routes/probes.js";
import { registry, httpRequestsTotal, httpRequestDuration } from "./lib/metrics.js";
import { authMiddleware, type AuthVariables } from "./middleware/auth.js";
import authRouter from "./routes/auth.js";
import { getConfig, validateProductionConfig } from "./config.js";
import { securityHeadersMiddleware } from "./middleware/security-headers.js";
import { initDatabase, runMigrations, closeDatabase, getDb, approvalRequests } from "./db/index.js";
import { getRateLimiter, resetRateLimiter } from "./lib/rate-limiter/index.js";
import { initLogger, getLogger, createRequestLogger } from "./lib/logger.js";
import { randomUUID } from "node:crypto";
import { startRetryScanner, encryptExistingSecrets } from "./lib/webhook.js";
import { startLastUsedFlusher, stopLastUsedFlusher } from "./lib/api-keys.js";
import { startCleanup, stopCleanup } from "./lib/cleanup.js";
import { sql } from "drizzle-orm";

// Create Hono app with typed variables
const app = new Hono<{ Variables: AuthVariables }>();

// Load config and initialize logger
const config = getConfig();
const log = initLogger();

// Enforce production security requirements
if (config.isProduction) {
  const warnings = validateProductionConfig(config);
  const criticalWarnings = warnings.filter(w => w.includes('ADMIN_API_KEY') || w.includes('JWT_SECRET'));
  if (criticalWarnings.length > 0) {
    log.fatal('Production security requirements not met');
    criticalWarnings.forEach(w => log.fatal(`  - ${w}`));
    log.fatal('Set ADMIN_API_KEY (min 16 chars) and JWT_SECRET (min 32 chars) environment variables to start in production mode.');
    process.exit(1);
  }
  // Log non-critical warnings
  warnings.filter(w => !w.includes('ADMIN_API_KEY')).forEach(w => log.warn(w));
}

// Request correlation ID middleware
app.use("*", async (c, next) => {
  const requestId = c.req.header("X-Request-Id") || randomUUID();
  c.set("requestId" as any, requestId);
  c.header("X-Request-Id", requestId);
  // Attach a child logger with the correlation ID
  c.set("log" as any, createRequestLogger(requestId));
  await next();
});

// Middleware
app.use("*", logger());

// CORS configuration:
// - If corsAllowedOrigins is set, use those specific origins
// - In development (no origins set), allow all origins
// - In production (no origins set), deny cross-origin requests (same-origin only)
app.use(
  "*",
  cors({
    origin: config.corsAllowedOrigins
      ? config.corsAllowedOrigins
      : config.isDevelopment
        ? "*"
        : (origin) => (origin ? null : origin), // Reject all cross-origin in production
    credentials: true,
  })
);
app.use("*", securityHeadersMiddleware);

// Body size limit for API routes (1MB) - prevents oversized payload attacks
app.use("/api/*", bodyLimit({ maxSize: 1024 * 1024 }));

// HTTP RED metrics middleware
app.use("*", async (c, next) => {
  const start = performance.now();
  await next();
  const durationSec = (performance.now() - start) / 1000;
  // Normalise route: replace UUIDs/nanoids with :id
  const route = c.req.path.replace(/\/[a-zA-Z0-9_-]{10,}(?=\/|$)/g, "/:id");
  const labels = { method: c.req.method, route, status: String(c.res.status) };
  httpRequestsTotal.inc(labels);
  httpRequestDuration.observe(labels, durationSec);
});

// Prometheus metrics endpoint (public, no auth)
if (config.metricsEnabled) {
  app.get("/metrics", async (c) => {
    const metrics = await registry.metrics();
    return c.text(metrics, 200, { "Content-Type": registry.contentType });
  });
}

// Readiness + Startup probes (public, no auth required)
app.route("/", probesRouter);

// Health check endpoint (public, no auth required)
// GET /health        → shallow check (fast, backward compatible)
// GET /health?deep=true → deep check (verifies DB connectivity)
app.get("/health", async (c) => {
  const deep = c.req.query("deep") === "true";

  if (!deep) {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  }

  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};
  let overallHealthy = true;

  // Check database
  try {
    const start = Date.now();
    const db = getDb();
    await db.select({ one: sql<number>`1` }).from(approvalRequests).limit(1);
    checks.database = { status: "healthy", latencyMs: Date.now() - start };
  } catch (err) {
    checks.database = { status: "unhealthy", error: String(err) };
    overallHealthy = false;
  }

  // Check Redis (only if using Redis backend)
  const healthConfig = getConfig();
  if (healthConfig.rateLimitBackend === "redis") {
    try {
      const start = Date.now();
      const limiter = getRateLimiter();
      const ok = await limiter.ping();
      if (ok) {
        checks.redis = { status: "healthy", latencyMs: Date.now() - start };
      } else {
        checks.redis = { status: "unhealthy", error: "Redis ping failed" };
        overallHealthy = false;
      }
    } catch (err) {
      checks.redis = { status: "unhealthy", error: String(err) };
      overallHealthy = false;
    }
  }

  const status = overallHealthy ? "ok" : "degraded";
  const httpStatus = overallHealthy ? 200 : 503;

  return c.json({ status, timestamp: new Date().toISOString(), checks }, httpStatus);
});

// Decision endpoint (public, no auth required - uses tokens)
app.route("/api/decide", decideRouter);

// Auth routes (mostly public — login, callback, refresh, logout)
// /auth/me requires auth and is handled inside the router
app.route("/auth", authRouter);

// Apply auth middleware to all /api/* routes
app.use("/api/*", authMiddleware);

// Mount API routes
app.route("/api/requests", requestsRouter);
app.route("/api", tokensRouter);
app.route("/api/policies", policiesRouter);
app.route("/api/api-keys", apiKeysRouter);
app.route("/api/webhooks", webhooksRouter);
app.route("/api/audit", auditRouter);
app.route("/api/overrides", overridesRouter);

// Global error handler
app.onError((err, c) => {
  // Always log full error server-side
  getLogger().error({ err }, `Error: ${err.message}`);

  // Only expose error details in development
  const isDev = process.env.NODE_ENV !== "production";

  return c.json(
    {
      error: "Internal Server Error",
      ...(isDev && { message: err.message }),
    },
    500
  );
});

// ─── Dashboard static serving ────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardDist = resolve(__dirname, '../../dashboard/dist');
let dashboardIndexHtml: string | null = null;

if (existsSync(resolve(dashboardDist, 'index.html'))) {
  dashboardIndexHtml = readFileSync(resolve(dashboardDist, 'index.html'), 'utf-8');

  // Serve static assets (JS, CSS, images)
  app.use('/assets/*', serveStatic({ root: dashboardDist }));
  app.use('/favicon.ico', serveStatic({ root: dashboardDist }));
}

// 404 handler — SPA fallback for dashboard routes, JSON 404 for API
app.notFound((c) => {
  // API routes always get JSON 404
  if (c.req.path.startsWith('/api/')) {
    return c.json(
      {
        error: "Not Found",
        message: `Route ${c.req.method} ${c.req.path} not found`,
      },
      404
    );
  }

  // SPA fallback: serve index.html for non-API routes
  if (dashboardIndexHtml) {
    return c.html(dashboardIndexHtml);
  }

  return c.json(
    {
      error: "Not Found",
      message: `Route ${c.req.method} ${c.req.path} not found`,
    },
    404
  );
});

// Start server
const port = parseInt(process.env.PORT || "3000", 10);

async function main() {
  // Initialize database BEFORE server starts listening.
  // This is critical for PostgreSQL which requires async initialization.
  // For SQLite, the sync `db` export still works, but all routes now use getDb()
  // which returns the same initialized instance.
  await initDatabase();
  getLogger().info("Database initialized.");

  await runMigrations();
  getLogger().info("Database migrations applied.");

  // Encrypt any existing plaintext webhook secrets
  const migrated = await encryptExistingSecrets();
  if (migrated > 0) {
    getLogger().info({ count: migrated }, 'Migrated plaintext webhook secrets to encrypted.');
  }

  getLogger().info(`Starting AgentGate server on port ${port}...`);

  const server = serve({
    fetch: app.fetch,
    port,
  });

  getLogger().info(`AgentGate server running at http://localhost:${port}`);

  // Start webhook retry scanner (persistent retries via DB polling)
  const retryScannerInterval = startRetryScanner();
  getLogger().info('Webhook retry scanner started (30s interval).');

  // Start batched lastUsedAt flusher (reduces per-request DB writes)
  startLastUsedFlusher();
  getLogger().info('API key lastUsedAt flusher started (60s interval).');

  // Start background cleanup job for expired tokens
  startCleanup();

  // Start background cleanup for expired overrides
  startOverrideCleanup();
  getLogger().info('Override cleanup started (60s interval).');
  getLogger().info(`Cleanup job started (${config.cleanupIntervalMs}ms interval, ${config.cleanupRetentionDays}d retention).`);

  // --- Graceful shutdown ---
  let shuttingDown = false;

  async function shutdown(signal: string) {
    if (shuttingDown) return; // Prevent double-shutdown
    shuttingDown = true;

    // Safety net: force exit after 10 seconds if shutdown stalls
    const forceExitTimeout = setTimeout(() => {
      getLogger().error('Forced shutdown after timeout.');
      process.exit(1);
    }, 10_000);
    forceExitTimeout.unref();

    getLogger().info(`${signal} received. Starting graceful shutdown...`);

    server.close(() => {
      getLogger().info('HTTP server closed.');
    });

    clearInterval(retryScannerInterval);
    getLogger().info('Webhook retry scanner stopped.');

    stopLastUsedFlusher();
    getLogger().info('API key lastUsedAt flusher stopped.');

    stopCleanup();
    getLogger().info('Cleanup job stopped.');

    stopOverrideCleanup();
    getLogger().info('Override cleanup stopped.');

    try {
      await resetRateLimiter();
      getLogger().info('Rate limiter cleaned up.');
    } catch (err) {
      getLogger().error({ err }, 'Error cleaning up rate limiter');
    }

    try {
      await closeDatabase();
      getLogger().info('Database connections closed.');
    } catch (err) {
      getLogger().error({ err }, 'Error closing database');
    }

    getLogger().info('Graceful shutdown complete.');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Only start the server when executed directly (not when imported by tests)
const isDirectRun =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]).includes("index");

if (isDirectRun && !process.env.VITEST) {
  main().catch((err) => {
    getLogger().fatal({ err }, "Failed to start server");
    process.exit(1);
  });
}

export default app;
